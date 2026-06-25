const { createClient } = require('@supabase/supabase-js');
const { Client } = require('basic-ftp');

const supabase = createClient(
process.env.SUPABASE_URL,
process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

const { event_id } = req.body;
if (!event_id) return res.status(400).json({ error: 'event_id requis' });

try {
// 1. Récupérer l'événement (pour connaître la date/heure de la course)
const { data: event, error: errEv } = await supabase
.from('events')
.select('id, event_date, name')
.eq('id', event_id)
.single();

if (errEv || !event) return res.status(404).json({ error: 'Événement introuvable' });

// 2. Se connecter en FTP à GPortal
const client = new Client();
client.ftp.verbose = false;

await client.access({
host: process.env.GPORTAL_FTP_HOST,
port: parseInt(process.env.GPORTAL_FTP_PORT, 10),
user: process.env.GPORTAL_FTP_USER,
password: process.env.GPORTAL_FTP_PASS,
secure: false
});

// 3. Lister les fichiers du dossier /results
const list = await client.list('/results');
client.close();

// Garder uniquement les fichiers de résultats de course (_R.json)
const raceFiles = list
.filter(f => f.name.endsWith('_R.json'))
.map(f => {
// format attendu: AAMMJJ_HHMMSS_R.json
const match = f.name.match(/^(\d{6})_(\d{6})_R\.json$/);
if (!match) return null;
const [, datePart, timePart] = match;
const yy = parseInt(datePart.slice(0, 2), 10) + 2000;
const mm = parseInt(datePart.slice(2, 4), 10) - 1;
const dd = parseInt(datePart.slice(4, 6), 10);
const hh = parseInt(timePart.slice(0, 2), 10);
const min = parseInt(timePart.slice(2, 4), 10);
const ss = parseInt(timePart.slice(4, 6), 10);
const fileDate = new Date(Date.UTC(yy, mm, dd, hh, min, ss));
return { name: f.name, date: fileDate };
})
.filter(Boolean);

if (!raceFiles.length) {
return res.status(404).json({ error: 'Aucun fichier de résultats de course trouvé sur le serveur' });
}

// 4. Trouver le fichier le plus proche de la date de l'événement
const eventDate = new Date(event.event_date);
raceFiles.sort((a, b) =>
Math.abs(a.date - eventDate) - Math.abs(b.date - eventDate)
);
const bestFile = raceFiles[0];

// Sécurité : si l'écart est trop grand (> 12h), on refuse (mauvais fichier probable)
const diffHours = Math.abs(bestFile.date - eventDate) / 1000 / 3600;
if (diffHours > 12) {
return res.status(404).json({
error: `Aucun fichier de résultats proche de la date de l'événement (écart le plus proche: ${diffHours.toFixed(1)}h, fichier: ${bestFile.name})`
});
}

// 5. Télécharger le fichier choisi
const client2 = new Client();
client2.ftp.verbose = false;
await client2.access({
host: process.env.GPORTAL_FTP_HOST,
port: parseInt(process.env.GPORTAL_FTP_PORT, 10),
user: process.env.GPORTAL_FTP_USER,
password: process.env.GPORTAL_FTP_PASS,
secure: false
});

const chunks = [];
const { Writable } = require('stream');
const writable = new Writable({
write(chunk, encoding, callback) {
chunks.push(chunk);
callback();
}
});

await client2.downloadTo(writable, `/results/${bestFile.name}`);
client2.close();

const fileContent = Buffer.concat(chunks).toString('utf-8');
const resultData = JSON.parse(fileContent);

const lines = resultData?.sessionResult?.leaderBoardLines || [];
if (!lines.length) {
return res.status(200).json({ message: 'Fichier trouvé mais aucun classement dedans', file: bestFile.name });
}

// 6. Récupérer tous les pilotes pour faire correspondre playerId -> pilot_id
const { data: pilots, error: errPilots } = await supabase
.from('pilots')
.select('id, platform_uid, platform');

if (errPilots) return res.status(500).json({ error: errPilots.message });

const pilotsByUid = {};
(pilots || []).forEach(p => {
if (p.platform_uid) pilotsByUid[p.platform_uid] = p.id;
});

// 7. Supprimer d'éventuels anciens résultats "race" pour cet événement (éviter les doublons)
await supabase
.from('results')
.delete()
.eq('event_id', event_id)
.eq('result_type', 'race');

// 8. Construire les lignes à insérer
const rows = lines.map((line, index) => {
const driver = line.currentDriver || {};
const playerId = driver.playerId || '';
// playerId format ACC: "P..." (PS5) ou "M..." (Xbox) + uid -> on cherche le uid sans préfixe
const uid = playerId.replace(/^[A-Z]/, '');
const pilotId = pilotsByUid[uid] || pilotsByUid[playerId] || null;

const totalTimeMs = (line.driverTotalTimes && line.driverTotalTimes[0])
? Math.round(line.driverTotalTimes[0])
: (line.timing?.totalTime ?? null);

const bestLapMs = line.timing?.bestLap && line.timing.bestLap < 2147483647
? line.timing.bestLap
: null;

return {
event_id,
pilot_id: pilotId,
result_type: 'race',
position: index + 1,
car_model: String(line.car?.carModel ?? ''),
best_lap_ms: bestLapMs,
total_time_ms: totalTimeMs,
penalty_seconds: 0,
points_earned: 0,
fastest_lap: false,
pole_position: false,
published_at: new Date().toISOString()
};
});

const { error: errInsert } = await supabase.from('results').insert(rows);
if (errInsert) return res.status(500).json({ error: errInsert.message });

return res.status(200).json({
message: `Résultats importés (${rows.length} pilotes)`,
file: bestFile.name,
event: event.name
});

} catch (e) {
console.error(e);
return res.status(500).json({ error: e.message });
}
};

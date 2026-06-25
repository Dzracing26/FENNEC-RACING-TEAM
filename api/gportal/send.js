const { createClient } = require('@supabase/supabase-js');
const { Client } = require('basic-ftp');
const { Writable } = require('stream');

const supabase = createClient(
process.env.SUPABASE_URL,
process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

const { type, event_id } = req.body;

if (!event_id) return res.status(400).json({ error: 'event_id requis' });

try {
// ============== RÉSULTATS (récupération FTP GPortal) ==============
if (type === 'results') {
const { data: event, error: errEv } = await supabase
.from('events')
.select('id, event_date, name')
.eq('id', event_id)
.single();

if (errEv || !event) return res.status(404).json({ error: 'Événement introuvable' });

const ftpConfig = {
host: process.env.GPORTAL_FTP_HOST,
port: parseInt(process.env.GPORTAL_FTP_PORT, 10),
user: process.env.GPORTAL_FTP_USER,
password: process.env.GPORTAL_FTP_PASS,
secure: false
};

const client = new Client();
client.ftp.verbose = false;
await client.access(ftpConfig);
const list = await client.list('/results');
client.close();

const raceFiles = list
.filter(f => f.name.endsWith('_R.json'))
.map(f => {
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

const eventDate = new Date(event.event_date);
raceFiles.sort((a, b) => Math.abs(a.date - eventDate) - Math.abs(b.date - eventDate));
const bestFile = raceFiles[0];

const diffHours = Math.abs(bestFile.date - eventDate) / 1000 / 3600;
if (diffHours > 12) {
return res.status(404).json({
error: `Aucun fichier de résultats proche de la date de l'événement (écart: ${diffHours.toFixed(1)}h, fichier: ${bestFile.name})`
});
}

const client2 = new Client();
client2.ftp.verbose = false;
await client2.access(ftpConfig);

const chunks = [];
const writable = new Writable({
write(chunk, encoding, callback) { chunks.push(chunk); callback(); }
});
await client2.downloadTo(writable, `/results/${bestFile.name}`);
client2.close();

let rawContent = Buffer.concat(chunks).toString('utf-8');
rawContent = rawContent.replace(/^\uFEFF/, '').trim();

try {
resultData = JSON.parse(rawContent);
} catch (parseErr) {
console.error('JSON Parse Error:', parseErr.message);
return res.status(400).json({
error: `Fichier JSON invalide: ${parseErr.message}`
});
}
}
const lines = resultData?.sessionResult?.leaderBoardLines || [];

if (!lines.length) {
return res.status(200).json({ message: 'Fichier trouvé mais aucun classement dedans', file: bestFile.name });
}

const { data: pilots, error: errPilots } = await supabase
.from('pilots')
.select('id, platform_uid');

if (errPilots) return res.status(500).json({ error: errPilots.message });

const pilotsByUid = {};
(pilots || []).forEach(p => { if (p.platform_uid) pilotsByUid[p.platform_uid] = p.id; });

await supabase.from('results').delete().eq('event_id', event_id).eq('result_type', 'race');

const rows = lines.map((line, index) => {
const playerId = line.currentDriver?.playerId || '';
const uid = playerId.replace(/^[A-Z]/, '');
const pilotId = pilotsByUid[uid] || pilotsByUid[playerId] || null;

const totalTimeMs = (line.driverTotalTimes && line.driverTotalTimes[0])
? Math.round(line.driverTotalTimes[0])
: (line.timing?.totalTime ?? null);

const bestLapMs = (line.timing?.bestLap && line.timing.bestLap < 2147483647)
? line.timing.bestLap : null;

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
}

// ============== ENTRYLIST / BOP (existant) ==============
const { data: regs, error: err1 } = await supabase
.from('registrations')
.select('pilot_id')
.eq('event_id', event_id)
.eq('status', 'confirmed');

if (err1) return res.status(500).json({ error: err1.message });
if (!regs.length) return res.status(200).json({ message: 'Aucun pilote inscrit', content: '' });

const pilotIds = regs.map(r => r.pilot_id);

const { data: pilots, error: err2 } = await supabase
.from('pilots')
.select('race_number, psn_id, discord_username, platform_uid, platform, gamertag')
.in('id', pilotIds);

if (err2) return res.status(500).json({ error: err2.message });

if (type === 'entrylist') {
const entrylist = {
entries: pilots.map(p => ({
drivers: [
{
playerID: (p.platform === 'xbox' ? 'M' : 'P') + p.platform_uid,
lastName: p.gamertag || p.psn_id || p.discord_username || 'Pilote',
driverCategory: 2
}
],
raceNumber: p.race_number,
forcedCarModel: -1,
overrideDriverInfo: 1,
isServerAdmin: 0,
overrideCarModelForCustomCar: true
})),
forceEntryList: 1
};

return res.status(200).json({
message: 'Entry list générée avec succès !',
content: JSON.stringify(entrylist, null, 2)
});
}

return res.status(400).json({ error: 'Type invalide' });

} catch (e) {
console.error('GPORTAL/SEND ERROR:', e);
return res.status(500).json({
error: e.message || 'Erreur inconnue',
stack: e.stack ? e.stack.split('\n').slice(0, 5).join(' | ') : null,
name: e.name || null
});
}
};

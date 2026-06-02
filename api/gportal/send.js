import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '../_middleware/auth.js';
import ftp from 'basic-ftp';

const supabase = createClient(
process.env.SUPABASE_URL,
process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function generateEntryList(eventId) {
const { data: registrations } = await supabase
.from('registrations')
.select('car_model, pilots(race_number, discord_username, platform, psn_id, gamertag, platform_uid)')
.eq('event_id', eventId)
.eq('status', 'confirmed');
const entries = (registrations || []).map(reg => {
const p = reg.pilots;
const name = p.discord_username;
const parts = name.split('_');
return {
drivers: [{
firstName: parts[0] || name,
lastName: parts.slice(1).join('_') || '',
shortName: name.substring(0, 3).toUpperCase(),
nationality: 97,
driverCategory: 3,
playerID: p.platform === 'ps5' ? `ps5|${p.platform_uid}` : `xbox|${p.platform_uid}`
}],
raceNumber: p.race_number,
forcedCarModel: -1,
overrideDriverInfo: 0,
customCar: '',
overrideCarModelForCustomCar: 0,
isServerAdmin: 0,
configVersion: 1
};
});
return JSON.stringify({ entries, forceEntryList: 1, configVersion: 1 }, null, 2);
}

async function generateBOP(eventId) {
const { data: bopEntries } = await supabase
.from('bop_configs')
.select('*')
.eq('event_id', eventId)
.eq('is_active', true);
const entries = (bopEntries || []).map(b => ({
tag: b.car_model.replace(/ /g, '_').toLowerCase(),
ballastKg: b.ballast_kg,
restrictor: b.restrictor
}));
return JSON.stringify({ entries }, null, 2);
}

async function sendViaFTP(fileName, content) {
const client = new ftp.Client(30000);
client.ftp.verbose = false;
try {
await client.access({
host: process.env.GPORTAL_FTP_HOST,
port: parseInt(process.env.GPORTAL_FTP_PORT) || 21,
user: process.env.GPORTAL_FTP_USER,
password: process.env.GPORTAL_FTP_PASS,
secure: false,
});
const cfgPath = process.env.GPORTAL_CFG_PATH || '/cfg/';
await client.ensureDir(cfgPath);
const { Readable } = await import('stream');
const stream = Readable.from([content]);
await client.uploadFrom(stream, `${cfgPath}${fileName}`);
return { success: true };
} catch (err) {
throw new Error(`FTP error: ${err.message}`);
} finally {
client.close();
}
}

export default async function handler(req, res) {
res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_SITE_URL);
res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
if (req.method === 'OPTIONS') return res.status(200).end();
if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
const admin = await requireAdmin(req, res);
if (!admin) return;
const { type, event_id } = req.body;
if (!['entrylist', 'bop'].includes(type)) return res.status(400).json({ error: 'type invalide' });
if (!event_id) return res.status(400).json({ error: 'event_id requis' });
try {
let content, fileName;
if (type === 'entrylist') { content = await generateEntryList(event_id); fileName = 'entrylist.json'; }
else { content = await generateBOP(event_id); fileName = 'bop.json'; }
await sendViaFTP(fileName, content);
await supabase.from('server_logs').insert({
action: `SEND_${type.toUpperCase()}`,
file_name: fileName,
status: 'success',
message: `${fileName} envoyé (event: ${event_id})`,
performed_by: admin.discord_username,
});
return res.status(200).json({ success: true, message: `✅ ${fileName} envoyé sur GPortal !`, content });
} catch (err) {
await supabase.from('server_logs').insert({
action: `SEND_${type.toUpperCase()}`,
file_name: type === 'entrylist' ? 'entrylist.json' : 'bop.json',
status: 'error',
message: err.message,
performed_by: admin.discord_username,
});
return res.status(500).json({ error: `Erreur FTP: ${err.message}` });
}
}

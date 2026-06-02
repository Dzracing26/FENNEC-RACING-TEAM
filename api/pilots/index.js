import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../_middleware/auth.js';

const supabase = createClient(
process.env.SUPABASE_URL,
process.env.SUPABASE_SERVICE_ROLE_KEY
);

const createAttempts = new Map();

function rateLimit(ip) {
const now = Date.now();
const attempts = createAttempts.get(ip) || [];
const recent = attempts.filter(t => now - t < 60000);
if (recent.length >= 3) return false;
recent.push(now);
createAttempts.set(ip, recent);
return true;
}

export default async function handler(req, res) {
res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_SITE_URL);
res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
if (req.method === 'OPTIONS') return res.status(200).end();

if (req.method === 'GET') {
const { data, error } = await supabase
.from('pilots')
.select('id, race_number, discord_username, platform, psn_id, gamertag, races_count, wins_count, points, created_at')
.eq('is_active', true)
.order('race_number', { ascending: true });
if (error) return res.status(500).json({ error: 'Erreur base de données' });
return res.status(200).json({ pilots: data });
}

if (req.method === 'POST') {
const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
if (!rateLimit(ip)) return res.status(429).json({ error: 'Trop de tentatives.' });
const user = await requireAuth(req, res);
if (!user) return;
console.log('USER:', JSON.stringify(user));
const { race_number, platform, psn_id, gamertag, platform_uid } = req.body;
if (!race_number || race_number < 1 || race_number > 999) return res.status(400).json({ error: 'Numéro invalide (1-99).' });
if (!['ps5', 'xbox'].includes(platform)) return res.status(400).json({ error: 'Plateforme invalide.' });
if (!platform_uid || platform_uid.length < 5) return res.status(400).json({ error: 'UID invalide.' });
if (platform === 'ps5' && !psn_id) return res.status(400).json({ error: 'PSN ID requis.' });
if (platform === 'xbox' && !gamertag) return res.status(400).json({ error: 'Gamertag requis.' });
const { data: existing } = await supabase.from('pilots').select('id').eq('race_number', race_number).single();
if (existing) return res.status(409).json({ error: `Le numéro #${race_number} est déjà pris.` });
const { data: alreadyPilot } = await supabase.from('pilots').select('id').eq('discord_id', user.discord_id).single();
if (alreadyPilot) return res.status(409).json({ error: 'Vous avez déjà un profil pilote.' });
const { data: newPilot, error: insertError } = await supabase
.from('pilots')
.insert({
discord_id: user.discord_id,
discord_username: user.discord_username,
race_number: parseInt(race_number),
platform,
psn_id: psn_id || null,
gamertag: gamertag || null,
platform_uid,
is_admin: user.discord_id === process.env.ADMIN_DISCORD_ID,
})
if (insertError) return res.status(500).json({ error: insertError.message });
return res.status(201).json({ pilot: newPilot, message: 'Profil créé avec succès !' });
}

res.status(405).json({ error: 'Méthode non autorisée' });
}

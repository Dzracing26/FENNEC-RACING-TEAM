import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '../_middleware/auth.js';

const supabase = createClient(
process.env.SUPABASE_URL,
process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_SITE_URL);
res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
if (req.method === 'OPTIONS') return res.status(200).end();

if (req.method === 'GET') {
const { data, error } = await supabase
.from('events')
.select('*, registrations(count)')
.neq('status', 'cancelled')
.order('event_date', { ascending: true });
if (error) return res.status(500).json({ error: 'Erreur base de données' });
return res.status(200).json({ events: data });
}

if (req.method === 'POST') {
const admin = await requireAdmin(req, res);
if (!admin) return;
const { name, track, event_date, quali_duration, race_duration, max_pilots, description, server_password } = req.body;
if (!name || !track || !event_date) return res.status(400).json({ error: 'Nom, circuit et date requis.' });
const { data, error } = await supabase
.from('events')
.insert({
name, track, event_date,
quali_duration: quali_duration || 20,
race_duration: race_duration || 60,
max_pilots: max_pilots || 30,
description: description || '',
server_password: server_password || null,
created_by: admin.discord_username,
})
.select()
.single();
if (error) return res.status(500).json({ error: 'Erreur création événement.' });
return res.status(201).json({ event: data });
}

res.status(405).json({ error: 'Méthode non autorisée' });
}

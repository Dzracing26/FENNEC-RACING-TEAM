import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '../_middleware/auth.js';

const supabase = createClient(
process.env.SUPABASE_URL,
process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
res.setHeader('Access-Control-Allow-Origin', '*');
res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
if (req.method === 'OPTIONS') return res.status(200).end();

if (req.method === 'GET') {
const { data, error } = await supabase
.from('events')
.select('*, registrations(count)')
.order('event_date', { ascending: true });
if (error) return res.status(500).json({ error: error.message });
return res.status(200).json({ events: data });
}

if (req.method === 'POST') {
const admin = await requireAdmin(req, res);
if (!admin) return;
const { name, track, event_date, race_duration, max_pilots, description } = req.body;
if (!name || !track || !event_date) return res.status(400).json({ error: 'Nom, circuit et date requis.' });
const { data, error } = await supabase
.from('events')
.insert({ name, track, event_date, race_duration: race_duration || 60, max_pilots: max_pilots || 30, description: description || '', created_by: admin.discord_username })
.select().single();
if (error) return res.status(500).json({ error: error.message });
return res.status(201).json({ event: data });
}

if (req.method === 'PUT') {
const admin = await requireAdmin(req, res);
if (!admin) return;
const { id, name, track, event_date, race_duration, max_pilots, description } = req.body;
if (!id) return res.status(400).json({ error: 'ID manquant' });
const { data, error } = await supabase
.from('events')
.update({ name, track, event_date, race_duration, max_pilots, description })
.eq('id', id).select().single();
if (error) return res.status(500).json({ error: error.message });
return res.status(200).json({ event: data });
}

if (req.method === 'DELETE') {
const admin = await requireAdmin(req, res);
if (!admin) return;
const { id } = req.body;
if (!id) return res.status(400).json({ error: 'ID manquant' });
const { error } = await supabase.from('events').delete().eq('id', id);
if (error) return res.status(500).json({ error: error.message });
return res.status(200).json({ success: true });
}

res.status(405).json({ error: 'Méthode non autorisée' });
}

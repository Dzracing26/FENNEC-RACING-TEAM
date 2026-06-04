import { createClient } from '@supabase/supabase-js';
import { requireMember } from '../_middleware/auth.js';

const supabase = createClient(
process.env.SUPABASE_URL,
process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_SITE_URL);
res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
if (req.method === 'OPTIONS') return res.status(200).end();

const user = await requireMember(req, res);
if (!user) return;

if (req.method === 'POST') {
const { event_id, car_model } = req.body;
if (!event_id) return res.status(400).json({ error: 'event_id requis.' });
const { data: event } = await supabase
.from('events')
.select('id, status, max_pilots')
.eq('id', event_id)
.eq('status', 'upcoming')
.single();
if (!event) return res.status(404).json({ error: 'Événement introuvable ou fermé.' });
const { data: pilot } = await supabase
.from('pilots')
.select('id')
.eq('discord_id', user.discord_id)
.single();
if (!pilot) return res.status(400).json({ error: 'Créez votre profil pilote d\'abord.' });
const { count } = await supabase
.from('registrations')
.select('id', { count: 'exact' })
.eq('event_id', event_id)
.eq('status', 'confirmed');
const status = count >= event.max_pilots ? 'waitlist' : 'confirmed';
const { data, error } = await supabase
.from('registrations')
.insert({ event_id, pilot_id: pilot.id, car_model: car_model || null, status })
.select()
.single();
if (error) {
if (error.code === '23505') return res.status(409).json({ error: 'Vous êtes déjà inscrit.' });
return res.status(500).json({ error: 'Erreur inscription.' });
}
return res.status(201).json({
registration: data,
message: status === 'confirmed' ? '✅ Inscription confirmée !' : '⏳ Liste d\'attente.',
});
}

if (req.method === 'DELETE') {
const { event_id } = req.body;
const { data: pilot } = await supabase.from('pilots').select('id').eq('discord_id', user.discord_id).single();
if (!pilot) return res.status(404).json({ error: 'Pilote introuvable.' });
const { error } = await supabase.from('registrations').delete().eq('event_id', event_id).eq('pilot_id', pilot.id);
if (error) return res.status(500).json({ error: 'Erreur désinscription.' });
return res.status(200).json({ message: 'Désinscription effectuée.' });
}
if (req.method === 'GET') {
const { event_id } = req.query;
if (!event_id) return res.status(400).json({ error: 'event_id requis' });
const { data: regs, error: err1 } = await supabase
.from('registrations')
.select('pilot_id')
.eq('event_id', event_id)
.eq('status', 'confirmed');
if (err1) return res.status(500).json({ error: err1.message });
if (!regs.length) return res.status(200).json({ pilots: [] });
const pilotIds = regs.map(r => r.pilot_id);
const { data: pilots, error: err2 } = await supabase
.from('pilots')
.select('id, race_number, discord_username, platform')
.in('id', pilotIds);
if (err2) return res.status(500).json({ error: err2.message });
return res.status(200).json({ pilots });
}

res.status(405).json({ error: 'Méthode non autorisée' });
}

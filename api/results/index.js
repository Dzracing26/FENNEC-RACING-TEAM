import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '../_middleware/auth.js';

const supabase = createClient(
process.env.SUPABASE_URL,
process.env.SUPABASE_SERVICE_ROLE_KEY
);

const POINTS_SYSTEM = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

export default async function handler(req, res) {
res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_SITE_URL);
res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
if (req.method === 'OPTIONS') return res.status(200).end();

if (req.method === 'GET') {
const { event_id, type } = req.query;
let query = supabase
.from('results')
.select('*, pilots(race_number, discord_username, platform, psn_id, gamertag)')
.order('position', { ascending: true });
if (event_id) query = query.eq('event_id', event_id);
if (type) query = query.eq('result_type', type);
const { data, error } = await query;
if (error) return res.status(500).json({ error: 'Erreur base de données' });
return res.status(200).json({ results: data });
}

if (req.method === 'POST') {
const admin = await requireAdmin(req, res);
if (!admin) return;
const { event_id, result_type, results } = req.body;
if (!event_id || !results || !Array.isArray(results)) return res.status(400).json({ error: 'event_id et results[] requis.' });
await supabase.from('results').delete().eq('event_id', event_id).eq('result_type', result_type || 'race');
const rows = [];
for (let i = 0; i < results.length; i++) {
const r = results[i];
const basePoints = result_type === 'race' ? (POINTS_SYSTEM[i] || 0) : 0;
const bonusPoints = (r.fastest_lap && i < 10 ? 1 : 0) + (r.pole_position ? 1 : 0);
const { data: pilot } = await supabase.from('pilots').select('id').eq('race_number', r.race_number).single();
if (!pilot) continue;
rows.push({
event_id,
pilot_id: pilot.id,
result_type: result_type || 'race',
position: r.position,
car_model: r.car_model || null,
best_lap_ms: r.best_lap_ms || null,
total_time_ms: r.total_time_ms || null,
penalty_seconds: r.penalty_seconds || 0,
points_earned: basePoints + bonusPoints,
fastest_lap: r.fastest_lap || false,
pole_position: r.pole_position || false,
});
}
const { error } = await supabase.from('results').insert(rows);
if (error) return res.status(500).json({ error: 'Erreur sauvegarde résultats.' });
return res.status(201).json({ success: true, message: `${rows.length} résultats sauvegardés.` });
}

res.status(405).json({ error: 'Méthode non autorisée' });
}

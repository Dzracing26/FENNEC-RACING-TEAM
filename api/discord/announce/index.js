import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '../../_middleware/auth.js';

const supabase = createClient(
process.env.SUPABASE_URL,
process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_SITE_URL);
res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
if (req.method === 'OPTIONS') return res.status(200).end();

const admin = await requireAdmin(req, res);
if (!admin) return;

if (req.method === 'POST') {
const { type, eventId, message } = req.body;

const { data: event } = await supabase.from('events').select('*').eq('id', eventId).single();
if (!event) return res.status(404).json({ error: 'Course introuvable.' });

const webhookUrl = process.env.DISCORD_WEBHOOK_EVENTS;
if (!webhookUrl) return res.status(500).json({ error: 'Webhook Discord non configuré.' });

let embed = {};

if (type === 'event') {
const date = new Date(event.event_date).toLocaleString('fr-FR');
embed = {
title: `🏁 COURSE À VENIR — ${event.name}`,
color: 0xff0080,
fields: [
{ name: '📍 Circuit', value: event.track, inline: true },
{ name: '📅 Date', value: date, inline: true },
{ name: '⏱️ Qualifs', value: `${event.quali_duration} min`, inline: true },
{ name: '🏎️ Course', value: `${event.race_duration} min`, inline: true },
{ name: '👥 Max pilotes', value: `${event.max_pilots}`, inline: true },
],
description: message || event.description || '',
footer: { text: `FENNEC RACING TEAM • Organisé par ${admin.discord_username}` }
};
}

if (type === 'results') {
const { data: results } = await supabase
.from('results')
.select('*, pilots(discord_username, race_number)')
.eq('event_id', eventId)
.eq('result_type', 'race')
.order('position', { ascending: true })
.limit(10);

const podium = results?.slice(0,3).map((r,i) => {
const medals = ['🥇','🥈','🥉'];
return `${medals[i]} #${r.pilots?.race_number} ${r.pilots?.discord_username} — ${r.points_earned} pts`;
}).join('\n') || 'Aucun résultat';

embed = {
title: `🏆 RÉSULTATS — ${event.name}`,
color: 0xffd700,
description: `**PODIUM**\n${podium}`,
footer: { text: `FENNEC RACING TEAM • Publié par ${admin.discord_username}` }
};
}

await fetch(webhookUrl, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ embeds: [embed] })
});

return res.status(200).json({ message: 'Publié sur Discord !' });
}

res.status(405).json({ error: 'Méthode non autorisée' });
}

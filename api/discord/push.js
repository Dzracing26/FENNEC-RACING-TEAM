import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '../_middleware/auth.js';

const supabase = createClient(
process.env.SUPABASE_URL,
process.env.SUPABASE_SERVICE_ROLE_KEY
);

const COLORS = {
event: 0xFF0080,
results: 0xFFD700,
bop: 0x00B4FF,
entrylist: 0x00FF88
};

async function sendWebhook(webhookUrl, embed) {
const res = await fetch(webhookUrl, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ embeds: [embed] }),
});
if (!res.ok) throw new Error(`Discord webhook error: ${res.status}`);
}

export default async function handler(req, res) {
res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_SITE_URL);
res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
if (req.method === 'OPTIONS') return res.status(200).end();
if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

const admin = await requireAdmin(req, res);
if (!admin) return;

const { type, event_id } = req.body;

try {
if (type === 'event') {
const { data: event } = await supabase.from('events').select('*, registrations(count)').eq('id', event_id).single();
if (!event) return res.status(404).json({ error: 'Event not found' });
const date = new Date(event.event_date);
await sendWebhook(process.env.DISCORD_WEBHOOK_EVENTS, {
color: COLORS.event,
title: `🏁 ${event.name}`,
description: event.description || '',
fields: [
{ name: '📅 Date', value: date.toLocaleDateString('fr-FR'), inline: true },
{ name: '🕐 Heure', value: date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) + ' CET', inline: true },
{ name: '🎮 Plateformes', value: 'PS5 × Xbox Series S Cross-Play', inline: false },
{ name: '⏱ Format', value: `Qualifications ${event.quali_duration}min → Course ${event.race_duration}min`, inline: false },
{ name: '👤 Places', value: `0 / ${event.max_pilots}`, inline: true },
],
footer: { text: 'Fennec Racing Team' },
timestamp: new Date().toISOString(),
});
return res.status(200).json({ success: true, message: '✅ Événement publié sur Discord !' });
}

if (type === 'results') {
const { data: results } = await supabase.from('results').select('*, pilots(discord_username, race_number, platform)').eq('event_id', event_id).eq('result_type', 'race').order('position', { ascending: true }).limit(10);
const { data: event } = await supabase.from('events').select('name').eq('id', event_id).single();
const medals = ['🥇', '🥈', '🥉'];
const podium = results.slice(0, 3).map((r, i) => `${medals[i]} P${r.position} — #${r.pilots.race_number} **${r.pilots.discord_username}** — ${r.points_earned} pts`).join('\n');
const others = results.slice(3).map(r => `P${r.position} — #${r.pilots.race_number} ${r.pilots.discord_username} — ${r.points_earned} pts`).join('\n');
await sendWebhook(process.env.DISCORD_WEBHOOK_RESULTS, {
color: COLORS.results,
title: `🏆 Résultats — ${event?.name || 'Course FRT'}`,
fields: [
{ name: '🏅 Podium', value: podium || 'Aucun résultat', inline: false },
...(others ? [{ name: '📋 Classement', value: others, inline: false }] : []),
],
footer: { text: 'Fennec Racing Team' },
timestamp: new Date().toISOString(),
});
return res.status(200).json({ success: true, message: '✅ Résultats publiés sur Discord !' });
}

if (type === 'bop') {
const { data: bop } = await supabase.from('bop_configs').select('*').eq('event_id', event_id).eq('is_active', true);
const { data: event } = await supabase.from('events').select('name').eq('id', event_id).single();
const bopText = (bop || []).map(b => `• **${b.car_model}** — Lest: ${b.ballast_kg > 0 ? '+' : ''}${b.ballast_kg}kg | Restriction: ${b.restrictor}%`).join('\n') || 'BOP par défaut ACC';
await sendWebhook(process.env.DISCORD_WEBHOOK_BOP, {
color: COLORS.bop,
title: `⚖️ BOP — ${event?.name || 'FRT'}`,
description: bopText,
footer: { text: 'Fennec Racing Team' },
timestamp: new Date().toISOString(),
});
return res.status(200).json({ success: true, message: '✅ BOP publiée sur Discord !' });
}

if (type === 'entrylist') {
const { data: registrations } = await supabase.from('registrations').select('pilots(race_number, discord_username, platform)').eq('event_id', event_id).eq('status', 'confirmed');
const { data: event } = await supabase.from('events').select('name, max_pilots').eq('id', event_id).single();
const list = (registrations || []).map(r => `#${r.pilots.race_number} ${r.pilots.discord_username} [${r.pilots.platform.toUpperCase()}]`).join('\n');
await sendWebhook(process.env.DISCORD_WEBHOOK_EVENTS, {
color: COLORS.entrylist,
title: `📋 Entry List — ${event?.name || 'FRT'}`,
description: `**${registrations?.length || 0} / ${event?.max_pilots || 30} pilotes**\n\n${list}`,
footer: { text: 'Fennec Racing Team' },
timestamp: new Date().toISOString(),
});
return res.status(200).json({ success: true, message: '✅ Entry List publiée sur Discord !' });
}

res.status(400).json({ error: 'Type invalide' });
} catch (err) {
console.error('Discord push error:', err);
res.status(500).json({ error: err.message });
}
}

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
const { pilotId, type, reason, value, eventId } = req.body;
if (!pilotId || !reason) return res.status(400).json({ error: 'Pilote et motif requis.' });

const { error } = await supabase.from('sanctions').insert({
pilot_id: pilotId,
type,
reason,
value: value || 0,
event_id: eventId || null,
created_by: admin.discord_username
});

if (error) return res.status(500).json({ error: error.message });

// Notifier via Discord webhook
try {
const { data: pilot } = await supabase.from('pilots').select('discord_id, discord_username').eq('id', pilotId).single();
const webhookUrl = process.env.DISCORD_WEBHOOK_BOP;
if (webhookUrl && pilot) {
await fetch(webhookUrl, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({
content: `⚠️ **SANCTION** — <@${pilot.discord_id}>\n**Type:** ${type}\n**Motif:** ${reason}\n**Par:** ${admin.discord_username}`
})
});
}
} catch(e) {}

return res.status(201).json({ message: 'Sanction appliquée.' });
}

res.status(405).json({ error: 'Méthode non autorisée' });
}

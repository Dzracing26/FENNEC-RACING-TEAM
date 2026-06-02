import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '../../_middleware/auth.js';

const supabase = createClient(
process.env.SUPABASE_URL,
process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_SITE_URL);
res.setHeader('Access-Control-Allow-Methods', 'PATCH, DELETE, OPTIONS');
res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
if (req.method === 'OPTIONS') return res.status(200).end();

const admin = await requireAdmin(req, res);
if (!admin) return;

if (req.method === 'PATCH') {
const { id, is_active } = req.body;
if (!id) return res.status(400).json({ error: 'ID requis.' });
const { error } = await supabase
.from('pilots')
.update({ is_active })
.eq('id', id);
if (error) return res.status(500).json({ error: error.message });
return res.status(200).json({ message: 'Pilote mis à jour.' });
}

if (req.method === 'DELETE') {
const { id } = req.body;
if (!id) return res.status(400).json({ error: 'ID requis.' });
const { error } = await supabase
.from('pilots')
.delete()
.eq('id', id);
if (error) return res.status(500).json({ error: error.message });
return res.status(200).json({ message: 'Pilote supprimé.' });
}

res.status(405).json({ error: 'Méthode non autorisée' });
}

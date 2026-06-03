import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
process.env.SUPABASE_URL,
process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
if (req.method !== 'DELETE') {
return res.status(405).json({ error: 'Méthode non autorisée' });
}

const { id } = req.body;
if (!id) return res.status(400).json({ error: 'ID manquant' });

const { error } = await supabase
.from('events')
.delete()
.eq('id', id);

if (error) return res.status(500).json({ error: error.message });

return res.status(200).json({ success: true });
}

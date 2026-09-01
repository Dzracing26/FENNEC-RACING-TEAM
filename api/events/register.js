import { createClient } from '@supabase/supabase-js';
import { requireMember, requireAdmin } from '../_middleware/auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SWAP_PILOT_FIELDS = 'id, race_number, discord_id, discord_avatar, discord_username, platform, psn_id, gamertag';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_SITE_URL);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ===== SWAP : corrections admin (PATCH) =====
  if (req.method === 'PATCH') {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    return swapPatch(req, res);
  }

  const user = await requireMember(req, res);
  if (!user) return;

  // ===== SWAP : aiguillage vers les equipes =====
  const isSwapGet = req.method === 'GET' && req.query && req.query.mode === 'swap';
  const isSwapBody = (req.method === 'POST' || req.method === 'DELETE')
    && req.body && req.body.mode === 'swap';
  if (isSwapGet) return swapGet(req, res);
  if (isSwapBody && req.method === 'POST') return swapPost(req, res, user);
  if (isSwapBody && req.method === 'DELETE') return swapDelete(req, res, user);

  // ===== SOLO : code d'origine, inchange =====
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
      .select('id, race_number, discord_username, platform, psn_id, gamertag')
      .in('id', pilotIds);
    if (err2) return res.status(500).json({ error: err2.message });
    return res.status(200).json({ pilots });
  }

  res.status(405).json({ error: 'Méthode non autorisée' });
}

// =========================================================
// SWAP — GET : liste des equipes d'un evenement
// =========================================================
async function swapGet(req, res) {
  const { event_id } = req.query;
  if (!event_id) return res.status(400).json({ error: 'event_id requis' });

  const { data: teams, error: errTeams } = await supabase
    .from('swap_teams')
    .select('id, team_name, car_number, created_by, created_at')
    .eq('event_id', event_id)
    .order('car_number', { ascending: true });
  if (errTeams) return res.status(500).json({ error: errTeams.message });
  if (!teams || !teams.length) return res.status(200).json({ teams: [] });

  const teamIds = teams.map(t => t.id);
  const { data: regs, error: errRegs } = await supabase
    .from('swap_registrations')
    .select('id, team_id, pilot_id, position')
    .in('team_id', teamIds)
    .order('position', { ascending: true });
  if (errRegs) return res.status(500).json({ error: errRegs.message });

  const pilotIds = [...new Set((regs || []).map(r => r.pilot_id))];
  const pilotsById = {};
  if (pilotIds.length) {
    const { data: pilots, error: errPilots } = await supabase
      .from('pilots')
      .select(SWAP_PILOT_FIELDS)
      .in('id', pilotIds);
    if (errPilots) return res.status(500).json({ error: errPilots.message });
    (pilots || []).forEach(p => { pilotsById[p.id] = p; });
  }

  const result = teams.map(t => {
    const members = (regs || [])
      .filter(r => r.team_id === t.id)
      .sort((a, b) => a.position - b.position)
      .map(r => ({
        registration_id: r.id,
        position: r.position,
        pilot: pilotsById[r.pilot_id] || null,
      }));
    return {
      id: t.id,
      team_name: t.team_name,
      car_number: t.car_number,
      created_by: t.created_by,
      pilots: members,
      pilots_count: members.length,
      free_positions: [1, 2, 3, 4, 5].filter(p => !members.some(m => m.position === p)),
    };
  });

  return res.status(200).json({ teams: result });
}

// =========================================================
// SWAP — POST : creer une equipe ou rejoindre une equipe
// =========================================================
async function swapPost(req, res, user) {
  const { event_id, team_name, car_number, team_id, position } = req.body || {};
  if (!event_id) return res.status(400).json({ error: 'event_id requis.' });

  const { data: event } = await supabase
    .from('events')
    .select('id, status, event_type, max_teams')
    .eq('id', event_id)
    .eq('status', 'upcoming')
    .single();
  if (!event) return res.status(404).json({ error: 'Événement introuvable ou fermé.' });
  if (event.event_type !== 'swap') {
    return res.status(400).json({ error: 'Cet événement n\'est pas un événement swap.' });
  }

  const { data: pilot } = await supabase
    .from('pilots')
    .select('id')
    .eq('discord_id', user.discord_id)
    .single();
  if (!pilot) return res.status(400).json({ error: 'Créez votre profil pilote d\'abord.' });

  // --- Rejoindre une equipe existante ---
  if (team_id) {
    const pos = Number(position);
    if (!Number.isInteger(pos) || pos < 1 || pos > 5) {
      return res.status(400).json({ error: 'Position invalide (1 à 5).' });
    }

    const { data: team } = await supabase
      .from('swap_teams')
      .select('id, team_name, event_id')
      .eq('id', team_id)
      .eq('event_id', event_id)
      .single();
    if (!team) return res.status(404).json({ error: 'Équipe introuvable.' });

    const { count: memberCount } = await supabase
      .from('swap_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('team_id', team_id);
    if ((memberCount || 0) >= 5) {
      return res.status(409).json({ error: 'Cette équipe est complète (5 pilotes).' });
    }

    const { data: reg, error } = await supabase
      .from('swap_registrations')
      .insert({ team_id, event_id, pilot_id: pilot.id, position: pos })
      .select()
      .single();
    if (error) {
      if (error.code === '23505') {
        if ((error.message || '').includes('position')) {
          return res.status(409).json({ error: 'Cette position est déjà prise dans l\'équipe.' });
        }
        return res.status(409).json({ error: 'Vous êtes déjà inscrit dans une équipe sur cet événement.' });
      }
      return res.status(500).json({ error: 'Erreur inscription équipe.' });
    }

    return res.status(201).json({
      registration: reg,
      message: `✅ Inscrit dans ${team.team_name} en position ${pos} !`,
    });
  }

  // --- Creer une equipe : le createur est pilote principal (position 1) ---
  const name = (team_name || '').trim();
  const num = Number(car_number);
  if (!name) return res.status(400).json({ error: 'Nom d\'équipe requis.' });
  if (name.length > 40) return res.status(400).json({ error: 'Nom d\'équipe trop long (40 caractères max).' });
  if (!Number.isInteger(num) || num < 0 || num > 999) {
    return res.status(400).json({ error: 'Numéro de voiture invalide (0 à 999).' });
  }

  if (event.max_teams) {
    const { count: teamCount } = await supabase
      .from('swap_teams')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', event_id);
    if ((teamCount || 0) >= event.max_teams) {
      return res.status(409).json({ error: 'Nombre maximum d\'équipes atteint.' });
    }
  }

  const { count: alreadyIn } = await supabase
    .from('swap_registrations')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', event_id)
    .eq('pilot_id', pilot.id);
  if ((alreadyIn || 0) > 0) {
    return res.status(409).json({ error: 'Vous êtes déjà inscrit dans une équipe sur cet événement.' });
  }

  const { data: team, error: errTeam } = await supabase
    .from('swap_teams')
    .insert({ event_id, team_name: name, car_number: num, created_by: pilot.id })
    .select()
    .single();
  if (errTeam) {
    if (errTeam.code === '23505') {
      if ((errTeam.message || '').includes('car_number')) {
        return res.status(409).json({ error: `Le numéro ${num} est déjà pris sur cet événement.` });
      }
      return res.status(409).json({ error: 'Ce nom d\'équipe est déjà utilisé sur cet événement.' });
    }
    return res.status(500).json({ error: 'Erreur création équipe.' });
  }

  const { data: reg, error: errReg } = await supabase
    .from('swap_registrations')
    .insert({ team_id: team.id, event_id, pilot_id: pilot.id, position: 1 })
    .select()
    .single();
  if (errReg) {
    // Rollback manuel : pas de transaction via l'API REST
    await supabase.from('swap_teams').delete().eq('id', team.id);
    if (errReg.code === '23505') {
      return res.status(409).json({ error: 'Vous êtes déjà inscrit dans une équipe sur cet événement.' });
    }
    return res.status(500).json({ error: 'Erreur création équipe.' });
  }

  return res.status(201).json({
    team,
    registration: reg,
    message: `✅ Équipe ${name} créée — voiture #${num}, vous êtes pilote principal.`,
  });
}

// =========================================================
// SWAP — DELETE : quitter son equipe
// =========================================================
async function swapDelete(req, res, user) {
  const { event_id } = req.body || {};
  if (!event_id) return res.status(400).json({ error: 'event_id requis.' });

  const { data: pilot } = await supabase
    .from('pilots')
    .select('id')
    .eq('discord_id', user.discord_id)
    .single();
  if (!pilot) return res.status(404).json({ error: 'Pilote introuvable.' });

  const { data: myReg } = await supabase
    .from('swap_registrations')
    .select('id, team_id, position')
    .eq('event_id', event_id)
    .eq('pilot_id', pilot.id)
    .single();
  if (!myReg) return res.status(404).json({ error: 'Vous n\'êtes inscrit dans aucune équipe.' });

  const { error: errDel } = await supabase
    .from('swap_registrations')
    .delete()
    .eq('id', myReg.id);
  if (errDel) return res.status(500).json({ error: 'Erreur désinscription.' });

  const { data: remaining } = await supabase
    .from('swap_registrations')
    .select('id, position')
    .eq('team_id', myReg.team_id)
    .order('position', { ascending: true });

  if (!remaining || !remaining.length) {
    await supabase.from('swap_teams').delete().eq('id', myReg.team_id);
    return res.status(200).json({ message: 'Désinscription effectuée. Équipe dissoute.' });
  }

  if (myReg.position === 1) {
    const next = remaining[0];
    await supabase
      .from('swap_registrations')
      .update({ position: 1 })
      .eq('id', next.id);
    const { data: nextReg } = await supabase
      .from('swap_registrations')
      .select('pilot_id')
      .eq('id', next.id)
      .single();
    if (nextReg) {
      await supabase
        .from('swap_teams')
        .update({ created_by: nextReg.pilot_id })
        .eq('id', myReg.team_id);
    }
    return res.status(200).json({
      message: 'Désinscription effectuée. Le pilote suivant devient principal.',
    });
  }

  return res.status(200).json({ message: 'Désinscription effectuée.' });
}

// =========================================================
// SWAP — PATCH : corrections admin
// =========================================================
async function swapPatch(req, res) {
  const { action } = req.body || {};

  if (action === 'update_team') {
    const { team_id, team_name, car_number } = req.body;
    if (!team_id) return res.status(400).json({ error: 'team_id requis.' });
    const patch = {};
    if (team_name !== undefined) {
      const n = (team_name || '').trim();
      if (!n) return res.status(400).json({ error: 'Nom d\'équipe vide.' });
      patch.team_name = n;
    }
    if (car_number !== undefined) {
      const num = Number(car_number);
      if (!Number.isInteger(num) || num < 0 || num > 999) {
        return res.status(400).json({ error: 'Numéro de voiture invalide (0 à 999).' });
      }
      patch.car_number = num;
    }
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'Rien à modifier.' });

    const { data, error } = await supabase
      .from('swap_teams')
      .update(patch)
      .eq('id', team_id)
      .select()
      .single();
    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Numéro ou nom déjà utilisé sur cet événement.' });
      }
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ team: data, message: 'Équipe modifiée.' });
  }

  if (action === 'move_pilot') {
    const { registration_id, position } = req.body;
    const pos = Number(position);
    if (!registration_id) return res.status(400).json({ error: 'registration_id requis.' });
    if (!Number.isInteger(pos) || pos < 1 || pos > 5) {
      return res.status(400).json({ error: 'Position invalide (1 à 5).' });
    }
    // Echange atomique cote Postgres : si la position visee est occupee,
    // les deux pilotes permutent. Impossible a faire proprement ici a cause
    // de la contrainte unique (team_id, position).
    const { error } = await supabase.rpc('swap_move_pilot', {
      p_reg: registration_id,
      p_pos: pos,
    });
    if (error) {
      const msg = error.message || '';
      if (msg.includes('REG_NOT_FOUND')) return res.status(404).json({ error: 'Inscription introuvable.' });
      if (msg.includes('BAD_POSITION')) return res.status(400).json({ error: 'Position invalide (1 à 5).' });
      return res.status(500).json({ error: msg || 'Erreur déplacement.' });
    }
    return res.status(200).json({ message: 'Position modifiée.' });
  }

  if (action === 'remove_pilot') {
    const { registration_id } = req.body;
    if (!registration_id) return res.status(400).json({ error: 'registration_id requis.' });
    const { error } = await supabase
      .from('swap_registrations')
      .delete()
      .eq('id', registration_id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ message: 'Pilote retiré de l\'équipe.' });
  }

  if (action === 'delete_team') {
    const { team_id } = req.body;
    if (!team_id) return res.status(400).json({ error: 'team_id requis.' });
    const { error } = await supabase
      .from('swap_teams')
      .delete()
      .eq('id', team_id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ message: 'Équipe supprimée.' });
  }

  return res.status(400).json({ error: 'Action inconnue.' });
}

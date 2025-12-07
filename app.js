// We use the global supabaseClient created in index.html

let drivers = []; // will be filled from DB

async function fetchDrivers() {
  const { data, error } = await supabaseClient
    .from('drivers')
    .select('*')
    .eq('active', true);

  if (error) {
    console.error('Error fetching drivers:', error.message);
    return [];
  }

  return data;
}

async function fetchLatestResultsPerDriver() {
  const { data, error } = await supabaseClient
    .from('results')
    .select('driver_id, cp_after, pi_after, penalty_for_next, races(round_number)');

  if (error) {
    console.error('Error fetching results:', error.message);
    return {};
  }

  const latest = {};

  for (const row of data) {
    const dId = row.driver_id;
    const round = row.races?.round_number ?? 0;

    if (!latest[dId] || round > (latest[dId].races?.round_number ?? 0)) {
      latest[dId] = row;
    }
  }

  return latest;
}

function computeStandings(drivers, latestResultsByDriver) {
  for (const driver of drivers) {
    const latest = latestResultsByDriver[driver.id];

    if (!latest) {
      driver.current_cp = 0;
      driver.current_pi = 0;
      driver.current_penalty = 0;
      driver.effective_pi = 0;
    } else {
      const cpAfter = latest.cp_after ?? 0;
      const piAfter = latest.pi_after ?? 0;
      const penaltyNext = latest.penalty_for_next ?? 0;

      driver.current_cp = cpAfter;
      driver.current_pi = piAfter;
      driver.current_penalty = penaltyNext;

      // Penalty applies to PI (max tuning points)
      driver.effective_pi = Math.max(0, piAfter - penaltyNext);
    }
  }

  // CP decides the place
  drivers.sort((a, b) => b.current_cp - a.current_cp);

  let place = 1;
  for (const driver of drivers) {
    driver.place = place++;
  }
}

async function updateStandings() {
  // latest results per driver → compute places and current CP/PI/penalty
  const latest = await fetchLatestResultsPerDriver();
  computeStandings(drivers, latest);

  // grid data
  const races = await fetchRaces();
  const allResults = await fetchAllResults();
  const resultMap = indexResultsByDriverAndRace(allResults);

  renderGrid(drivers, races, resultMap);
}

async function fetchRaces() {
  const { data, error } = await supabaseClient
    .from('races')
    .select('*')
    .order('round_number', { ascending: true });

  if (error) {
    console.error('Error fetching races:', error.message);
    return [];
  }

  return data;
}

async function fetchAllResults() {
  const { data, error } = await supabaseClient
    .from('results')
    .select('*');

  if (error) {
    console.error('Error fetching all results:', error.message);
    return [];
  }

  return data;
}

function indexResultsByDriverAndRace(results) {
  const map = {}; // key: driverId_raceId

  for (const r of results) {
    const key = `${r.driver_id}_${r.race_id}`;
    map[key] = r;
  }

  return map;
}

function renderGrid(drivers, races, resultMap) {
  const headerRow = document.getElementById('grid-header-row');
  const tbody = document.getElementById('grid-body');

  headerRow.innerHTML = '';
  tbody.innerHTML = '';

  // Header: first cell is the "Drivers" column
  const firstTh = document.createElement('th');
  firstTh.textContent = 'Driver / Race';
  headerRow.appendChild(firstTh);

  // Then one header cell per race, left to right
  for (const race of races) {
    const th = document.createElement('th');
    const raceLabel = race.name ? race.name : `Race ${race.round_number}`;

    th.innerHTML = `
      <div>${raceLabel}</div>
      <div style="font-size:0.85em; opacity:0.7;">CP | PI | Pen</div>
    `;
    headerRow.appendChild(th);
  }

  // Body: one row per driver (in current standings order)
  for (const driver of drivers) {
    const tr = document.createElement('tr');

    // Left cell: place, name, car, and current CP/PI after penalty
    const leftTd = document.createElement('td');
    const placeText = driver.place ? `${driver.place}. ` : '';
    const effectivePi = driver.effective_pi ?? driver.current_pi ?? 0;

    leftTd.innerHTML = `
      <div>${placeText}${driver.name}</div>
      <div style="font-size:0.85em; opacity:0.8;">${driver.car}</div>
      <div style="font-size:0.8em; opacity:0.8; margin-top:2px;">
        CP: ${driver.current_cp ?? 0} | PI: ${effectivePi}
      </div>
    `;
    tr.appendChild(leftTd);

    // Then one cell per race for this driver
    for (const race of races) {
      const td = document.createElement('td');
      const key = `${driver.id}_${race.id}`;
      const r = resultMap[key];

      if (!r) {
        td.innerHTML = '<div style="opacity:0.4;">-</div>';
      } else {
        const cpBefore   = r.cp_before ?? 0;
        const piBefore   = r.pi_before ?? 0;
        const penBefore  = r.penalty_before ?? 0;

        const cpAfter    = r.cp_after ?? cpBefore;
        const piAfter    = r.pi_after ?? piBefore;
        const penNext    = r.penalty_for_next ?? penBefore;

        // This-race change
        const dCp  = cpAfter - cpBefore;
        const dPi  = piAfter - piBefore;
        const dPen = penNext - penBefore;

        // Top: per-race change
        // Bottom: current values before this race
        td.innerHTML = `
          <div>${dCp} | ${dPi} | ${dPen}</div>
          <div style="font-size:0.85em; opacity:0.8;">
            ${cpBefore} | ${piBefore} | ${penBefore}
          </div>
        `;
      }

      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }
}

// --- Auth (basic email/password) ---

async function login() {
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;

  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email,
    password,
  });

  const status = document.getElementById('login-status');

  if (error) {
    console.error('Login error:', error.message);
    status.textContent = 'Login failed: ' + error.message;
    return;
  }

  status.textContent = 'Logged in as: ' + email;
  document.getElementById('login-button').style.display = 'none';
  document.getElementById('logout-button').style.display = 'inline-block';
}

async function logout() {
  await supabaseClient.auth.signOut();
  document.getElementById('login-status').textContent = 'Logged out.';
  document.getElementById('login-button').style.display = 'inline-block';
  document.getElementById('logout-button').style.display = 'none';
}

// Attach event listeners after DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
  document
    .getElementById('update-standings-button')
    .addEventListener('click', updateStandings);

  document
    .getElementById('login-button')
    .addEventListener('click', login);

  document
    .getElementById('logout-button')
    .addEventListener('click', logout);

  // Initial load of drivers
  drivers = await fetchDrivers();
  // First render (no standings yet) or you can immediately call updateStandings
  await updateStandings();
});

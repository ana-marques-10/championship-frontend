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

function renderStandings(drivers) {
  const tbody = document.querySelector('#standings-table tbody');
  tbody.innerHTML = '';

  for (const driver of drivers) {
    const tr = document.createElement('tr');

    const placeTd = document.createElement('td');
    placeTd.textContent = driver.place ?? '-';

    const nameTd = document.createElement('td');
    nameTd.textContent = driver.name;

    const carTd = document.createElement('td');
    carTd.textContent = driver.car;

    const currentCpTd = document.createElement('td');
    currentCpTd.textContent = driver.current_cp ?? 0;

    const currentPiTd = document.createElement('td');
    currentPiTd.textContent = driver.current_pi ?? 0;

    const penaltyTd = document.createElement('td');
    penaltyTd.textContent = driver.current_penalty ?? 0;

    const effectiveCpTd = document.createElement('td');
    effectiveCpTd.textContent = driver.effective_cp ?? 0;

    tr.appendChild(placeTd);
    tr.appendChild(nameTd);
    tr.appendChild(carTd);
    tr.appendChild(currentCpTd);
    tr.appendChild(currentPiTd);
    tr.appendChild(penaltyTd);
    tr.appendChild(effectiveCpTd);

    tbody.appendChild(tr);
  }
}

async function updateStandings() {
  // 1) latest results per driver → standings
  const latest = await fetchLatestResultsPerDriver();
  computeStandings(drivers, latest);
  renderStandings(drivers);

  // 2) championship grid
  const races = await fetchRaces();
  const allResults = await fetchAllResults();
  const resultMap = indexResultsByRaceAndDriver(allResults);
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

function indexResultsByRaceAndDriver(results) {
  const map = {}; // key: `${race_id}_${driver_id}`

  for (const r of results) {
    const key = `${r.race_id}_${r.driver_id}`;
    map[key] = r;
  }

  return map;
}

function renderGrid(drivers, races, resultMap) {
  const headerRow = document.getElementById('grid-header-row');
  const tbody = document.getElementById('grid-body');

  headerRow.innerHTML = '';
  tbody.innerHTML = '';

  // Header: first cell "Race"
  const raceHeaderTh = document.createElement('th');
  raceHeaderTh.textContent = 'Race';
  headerRow.appendChild(raceHeaderTh);

  // Then one header cell per driver (place + name + car)
  for (const driver of drivers) {
    const th = document.createElement('th');
    const placeText = driver.place ? `${driver.place}. ` : '';

  const effectivePi = driver.effective_pi ?? driver.current_pi ?? 0;

  th.innerHTML = `
    <div>${placeText}${driver.name}</div>
    <div style="font-size: 0.85em; opacity: 0.8;">${driver.car}</div>
    <div style="font-size: 0.8em; opacity: 0.8; margin-top:2px;">
      CP: ${driver.current_cp} | PI: ${effectivePi}
    </div>
  `;

    headerRow.appendChild(th);
  }

  // One row per race
  for (const race of races) {
    const tr = document.createElement('tr');

    const raceCell = document.createElement('td');
    const raceLabel = race.name ? race.name : `Race ${race.round_number}`;
    raceCell.innerHTML = `
      <div>${raceLabel}</div>
      <div style="font-size:0.85em; opacity:0.7;">CP | PI | Pen</div>
    `;
    tr.appendChild(raceCell);

    // One cell per driver
    for (const driver of drivers) {
      const td = document.createElement('td');
      const key = `${race.id}_${driver.id}`;
      const r = resultMap[key];

      if (!r) {
        td.innerHTML = '<div style="opacity:0.4;">-</div>';
      } else {
        const cpBefore = r.cp_before ?? 0;
        const piBefore = r.pi_before ?? 0;
        const penBefore = r.penalty_before ?? 0;

        const cpAfter = r.cp_after ?? cpBefore;
        const piAfter = r.pi_after ?? piBefore;
        const penNext = r.penalty_for_next ?? penBefore;

        const dCp  = cpAfter - cpBefore;
        const dPi  = piAfter - piBefore;
        const dPen = penNext - penBefore;

        // Top line: change in this race
        // Bottom line: current values before this race
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

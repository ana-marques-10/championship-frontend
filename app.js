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
    // remove the .order(...) line completely

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
  // attach current values to each driver
  for (const driver of drivers) {
    const latest = latestResultsByDriver[driver.id];

    if (!latest) {
      driver.current_cp = 0;
      driver.current_pi = 0;
      driver.current_penalty = 0;
      driver.effective_cp = 0;
    } else {
      const cpAfter = latest.cp_after ?? 0;
      const piAfter = latest.pi_after ?? 0;
      const penaltyNext = latest.penalty_for_next ?? 0;

      driver.current_cp = cpAfter;
      driver.current_pi = piAfter;
      driver.current_penalty = penaltyNext;
      driver.effective_cp = cpAfter - penaltyNext;
    }
  }

  // sort by effective_cp descending
  drivers.sort((a, b) => b.effective_cp - a.effective_cp);

  // assign place numbers
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
  const latest = await fetchLatestResultsPerDriver();
  computeStandings(drivers, latest);
  renderStandings(drivers);
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

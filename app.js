// We use the global supabaseClient created in index.html
const CURRENT_CHAMPIONSHIP_ID = 'b24ca658-861d-469b-8e14-419267b728ff';

let drivers = []; // will be filled from DB
let isAdmin = false;

async function refreshAdminStatus() {
  const { data: { user }, error } = await supabaseClient.auth.getUser();
  if (error || !user) {
    isAdmin = false;
    return;
  }

  const { data, error: adminError } = await supabaseClient
    .from('admins')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();

  isAdmin = !adminError && !!data;
}

async function createDriver(name, car) {
  const { error } = await supabaseClient
    .from('drivers')
    .insert({
      name: name,
      car: car,
      active: true,
      championship_id: CURRENT_CHAMPIONSHIP_ID
    });

  if (error) {
    console.error("Error creating driver:", error.message);
    alert("Error: " + error.message);
  }
}

async function deleteDriver(driverId) {
  const { error } = await supabaseClient
    .from('drivers')
    .delete()
    .eq('id', driverId);

  if (error) {
    console.error("Error deleting driver:", error.message);
    alert("Delete failed: " + error.message);
  }
}
function renderDriversAdmin(drivers) {
  const container = document.getElementById('drivers-admin-list');
  if (!container) return;

  if (!isAdmin) {
    container.innerHTML = "<em>Login as admin to edit drivers.</em>";
    return;
  }

  if (!drivers || drivers.length === 0) {
    container.innerHTML = "<em>No drivers yet.</em>";
    return;
  }

  let html = "<ul style='list-style:none; padding-left:0;'>";

  for (const d of drivers) {
    html += `
      <li style="margin: 4px 0;">
        ${d.name} (${d.car})
        <button class="driver-delete-btn" data-driver-id="${d.id}">
          Remove
        </button>
      </li>
    `;
  }

  html += "</ul>";

  container.innerHTML = html;
}

async function fetchDrivers() {
  const { data, error } = await supabaseClient
    .from('drivers')
    .select('*')
    .eq('active', true)
    .eq('championship_id', CURRENT_CHAMPIONSHIP_ID);

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
  // 1) latest results per driver → compute places and current CP/PI/penalty
  const latest = await fetchLatestResultsPerDriver();
  computeStandings(drivers, latest);

  // 2) fetch full grid data
  const races = await fetchRaces();
  const allResults = await fetchAllResults();
  const resultMap = indexResultsByDriverAndRace(allResults);

  // 3) render main championship grid
  renderGrid(drivers, races, resultMap);

  // 4) render drivers admin panel
  renderDriversAdmin(drivers);
}


async function fetchRaces() {
  const { data, error } = await supabaseClient
    .from('races')
    .select('*')
    .eq('championship_id', CURRENT_CHAMPIONSHIP_ID)
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
    .select('id, driver_id, race_id, cp_before, pi_before, penalty_before, cp_after, pi_after, penalty_for_next');

  if (error) {
    console.error('Error fetching all results:', error.message);
    return [];
  }

  return data;
}

function indexResultsByDriverAndRace(results) {
  const map = {};
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

  // Header: first column is the driver info
  const firstTh = document.createElement('th');
  firstTh.textContent = 'Driver / Race';
  headerRow.appendChild(firstTh);

  // One header per race
  for (const race of races) {
    const th = document.createElement('th');
    const raceLabel = race.name ? race.name : `Race ${race.round_number}`;

    th.innerHTML = `
      <div>${raceLabel}</div>
      <div style="font-size:0.85em; opacity:0.7;">CP | PI | Pen</div>
    `;
    headerRow.appendChild(th);
  }

  // One row per driver
  for (const driver of drivers) {
    const tr = document.createElement('tr');

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

    // Each race cell
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

        const dCp  = cpAfter - cpBefore;
        const dPi  = piAfter - piBefore;
        const dPen = penNext - penBefore;

        if (!isAdmin) {
          // read-only view
          td.innerHTML = `
            <div>${dCp} | ${dPi} | ${dPen}</div>
            <div style="font-size:0.85em; opacity:0.8;">
              ${cpBefore} | ${piBefore} | ${penBefore}
            </div>
          `;
        } else {
          // editable mini-grid
          td.innerHTML = `
            <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:2px; margin-bottom:2px;">
              <input type="number" id="cp_after_${r.id}" value="${cpAfter}"  style="width:100%; box-sizing:border-box;" />
              <input type="number" id="pi_after_${r.id}" value="${piAfter}"  style="width:100%; box-sizing:border-box;" />
              <input type="number" id="pen_next_${r.id}" value="${penNext}"  style="width:100%; box-sizing:border-box;" />
            </div>
            <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:2px; font-size:0.85em;">
              <input type="number" id="cp_before_${r.id}" value="${cpBefore}" style="width:100%; box-sizing:border-box;" />
              <input type="number" id="pi_before_${r.id}" value="${piBefore}" style="width:100%; box-sizing:border-box;" />
              <input type="number" id="pen_before_${r.id}" value="${penBefore}" style="width:100%; box-sizing:border-box;" />
            </div>
            <button class="cell-save" data-result-id="${r.id}" style="margin-top:2px; font-size:0.75em;">
              Save
            </button>
          `;
        }
      }

      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }
}

async function saveResultFromCell(resultId) {
  const cpBefore  = parseInt(document.getElementById(`cp_before_${resultId}`).value || '0', 10);
  const piBefore  = parseInt(document.getElementById(`pi_before_${resultId}`).value || '0', 10);
  const penBefore = parseInt(document.getElementById(`pen_before_${resultId}`).value || '0', 10);

  const cpAfter   = parseInt(document.getElementById(`cp_after_${resultId}`).value || '0', 10);
  const piAfter   = parseInt(document.getElementById(`pi_after_${resultId}`).value || '0', 10);
  const penNext   = parseInt(document.getElementById(`pen_next_${resultId}`).value || '0', 10);

  const { error } = await supabaseClient
    .from('results')
    .update({
      cp_before: cpBefore,
      pi_before: piBefore,
      penalty_before: penBefore,
      cp_after: cpAfter,
      pi_after: piAfter,
      penalty_for_next: penNext,
    })
    .eq('id', resultId);

  if (error) {
    console.error('Error saving result:', error.message);
    alert('Save failed: ' + error.message);
    return;
  }

  await updateStandings();
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
    status.textContent = 'Login failed: ' + error.message;
    return;
  }

  status.textContent = 'Logged in as: ' + email;
  document.getElementById('login-button').style.display = 'none';
  document.getElementById('logout-button').style.display = 'inline-block';

  await refreshAdminStatus();
  await updateStandings(); // redraw with edit controls if admin
}

async function logout() {
  await supabaseClient.auth.signOut();
  isAdmin = false;

  document.getElementById('login-status').textContent = 'Logged out.';
  document.getElementById('login-button').style.display = 'inline-block';
  document.getElementById('logout-button').style.display = 'none';

  await updateStandings(); // redraw without edit controls
}

// Attach event listeners after DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
  const updateBtn = document.getElementById('update-standings-button');
  if (updateBtn) {
    updateBtn.addEventListener('click', updateStandings);
  }

  const loginBtn = document.getElementById('login-button');
  if (loginBtn) {
    loginBtn.addEventListener('click', login);
  }

  const logoutBtn = document.getElementById('logout-button');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', logout);
  }

  // Add-driver button
  const addBtn = document.getElementById("add-driver-button");
  if (addBtn) {
    addBtn.addEventListener("click", async () => {
      if (!isAdmin) {
        alert("Only admins can add drivers.");
        return;
      }
  
      const name = document.getElementById("new-driver-name").value.trim();
      const car = document.getElementById("new-driver-car").value.trim();
  
      if (!name || !car) {
        alert("Driver name and car are required.");
        return;
      }
  
      await createDriver(name, car);
  
      // Reload drivers + grid
      drivers = await fetchDrivers();
      await updateStandings();
      renderDriversAdmin(drivers);
  
      document.getElementById("new-driver-name").value = "";
      document.getElementById("new-driver-car").value = "";
    });
  }
  
  // Driver delete buttons (event delegation)
  const driversAdminDiv = document.getElementById("drivers-admin-list");
  if (driversAdminDiv) {
    driversAdminDiv.addEventListener("click", async (e) => {
      const btn = e.target.closest(".driver-delete-btn");
      if (!btn) return;
  
      if (!isAdmin) {
        alert("Only admins can delete drivers.");
        return;
      }
  
      const driverId = btn.dataset.driverId;
  
      if (confirm("Are you sure you want to remove this driver?")) {
        await deleteDriver(driverId);
  
        drivers = await fetchDrivers();
        await updateStandings();
        renderDriversAdmin(drivers);
      }
    });
  }

  // event delegation for Save buttons inside cells
  const gridBody = document.getElementById('grid-body');
  if (gridBody) {
    gridBody.addEventListener('click', (e) => {
      const btn = e.target.closest('.cell-save');
      if (!btn) return;
      const id = btn.dataset.resultId;
      saveResultFromCell(id);
    });
  }

  await refreshAdminStatus();
  drivers = await fetchDrivers();
  await updateStandings();
});


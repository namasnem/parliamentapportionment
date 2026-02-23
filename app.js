const modeInputs = [...document.querySelectorAll('input[name="mode"]')];
const form = document.getElementById('calc-form');
const citizensInput = document.getElementById('citizens');
const votingSeatsField = document.getElementById('voting-seats-field');
const votingSeatsInput = document.getElementById('voting-seats');
const sampleBtn = document.getElementById('sample-btn');
const errorEl = document.getElementById('error');
const resultsEl = document.getElementById('results');
const summaryEl = document.getElementById('result-summary');
const detailsEl = document.getElementById('result-details');

const preferredMagnitudes = [5, 4, 6];

// Valid STV constituency sizes (remainder values that can stand alone as a constituency)
const STV_VALID_MAGNITUDES = [3, 4, 5, 6];
// Small remainder counts that must be absorbed by downgrading larger constituencies
const STV_SMALL_REMAINDERS = [1, 2];

const MAX_CITIZENS = 10_000_000_000;

const MANDATORIUM_C0 = 30000000;
const MANDATORIUM_S0 = 400;
const MANDATORIUM_LOW_CEILING = 65000000;
const MANDATORIUM_TRANSITION_TOP = 90000000;
const MANDATORIUM_LOW_RATIO_AT_CEILING = 75000;
const MANDATORIUM_LOW_RATIO_AT_FLOOR = 60000;
const MANDATORIUM_LOW_FLOOR_POPULATION = 5000000;
const MANDATORIUM_LOW_CURVE_EXPONENT = 1.4;
const MANDATORIUM_TRANSITION_RATIO_AT_TOP = 300000;
const MANDATORIUM_LOW_MIN_RATIO = 30000;
const MANDATORIUM_C1 = 150000000;
const MANDATORIUM_C2 = 600000000;
const MANDATORIUM_RMID = 300000;
const MANDATORIUM_RHI = 600000;

const ceilDiv = (a, b) => Math.floor((a + b - 1) / b);

const MAX_ASCENDIUM_VOTING_SEATS = 100000000;

const sortMagnitudeCounts = (counts) => Object.fromEntries(
  Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
);

const chooseStvPlan = (totalSeats, preferred = preferredMagnitudes) => {
  if (totalSeats === 0) {
    return { magnitudeCounts: {}, constituencyCount: 0, note: 'no STV seats' };
  }

  for (const m of preferred) {
    if (m > 0 && totalSeats % m === 0) {
      const magnitudeCounts = { [m]: totalSeats / m };
      return { magnitudeCounts, constituencyCount: magnitudeCounts[m], note: `uniform ${m}-seat STV constituencies` };
    }
  }

  for (const base of preferred) {
    if (base < 3) continue;

    const k0 = Math.floor(totalSeats / base);
    let r = totalSeats - base * k0;
    const magnitudeCounts = { [base]: k0 };
    let constituencyCount = k0;

    if (r === 0) {
      return { magnitudeCounts, constituencyCount, note: `mixed plan base ${base} (exact)` };
    }

    if (STV_VALID_MAGNITUDES.includes(r)) {
      magnitudeCounts[r] = (magnitudeCounts[r] || 0) + 1;
      constituencyCount += 1;
      return {
        magnitudeCounts: sortMagnitudeCounts(magnitudeCounts),
        constituencyCount,
        note: `mixed plan base ${base} + one ${r}-seat constituency`,
      };
    }

    let conversions = 0;
    while (STV_SMALL_REMAINDERS.includes(r) && conversions < k0) {
      magnitudeCounts[base] -= 1;
      magnitudeCounts[base - 1] = (magnitudeCounts[base - 1] || 0) + 1;
      conversions += 1;
      r += 1;
    }

    if (STV_VALID_MAGNITUDES.includes(r)) {
      magnitudeCounts[r] = (magnitudeCounts[r] || 0) + 1;
      constituencyCount += 1;
      return {
        magnitudeCounts: sortMagnitudeCounts(magnitudeCounts),
        constituencyCount,
        note: `mixed plan base ${base} with ${conversions} downgraded constituencies + one ${r}-seat constituency`,
      };
    }
  }

  return { magnitudeCounts: { [totalSeats]: 1 }, constituencyCount: 1, note: 'fallback: single STV constituency (not recommended)' };
};

const stvTargetsByMagnitude = (citizens, stvSeatsTotal, counts) => {
  if (stvSeatsTotal <= 0) return {};
  const cps = citizens / stvSeatsTotal;
  const out = {};

  Object.entries(counts).forEach(([m, count]) => {
    out[m] = {
      count,
      targetPopulationPerConstituency: Number(m) * cps,
      citizensPerStvSeat: cps,
    };
  });

  return out;
};

const describeMagnitudes = (counts) => {
  const parts = Object.entries(sortMagnitudeCounts(counts)).map(([magnitude, count]) => `${count}×${magnitude}`);
  return parts.length ? parts.join(', ') : 'None';
};

const mandatoriumSeatCount = (citizens) => {
  const C = citizens;

  const S1 = ceilDiv(MANDATORIUM_C1, MANDATORIUM_RMID);
  const S2 = ceilDiv(MANDATORIUM_C2, MANDATORIUM_RMID);

  if (C <= MANDATORIUM_LOW_CEILING) {
    const lowSpan = MANDATORIUM_LOW_CEILING - MANDATORIUM_LOW_FLOOR_POPULATION;
    const progress = Math.max(0, Math.min(1, (C - MANDATORIUM_LOW_FLOOR_POPULATION) / lowSpan));
    const curvedProgress = progress ** MANDATORIUM_LOW_CURVE_EXPONENT;
    const targetRatio = MANDATORIUM_LOW_RATIO_AT_FLOOR + curvedProgress * (MANDATORIUM_LOW_RATIO_AT_CEILING - MANDATORIUM_LOW_RATIO_AT_FLOOR);
    const seats = ceilDiv(C, Math.max(MANDATORIUM_LOW_MIN_RATIO, Math.round(targetRatio)));

    return {
      regime: 'L (progressive low ratio)',
      totalSeats: Math.max(1, seats),
      C0: MANDATORIUM_C0,
      S0: MANDATORIUM_S0,
      C1: MANDATORIUM_C1,
      C2: MANDATORIUM_C2,
      S1,
      S2,
      Rmid: MANDATORIUM_RMID,
      Rhi: MANDATORIUM_RHI,
      targetRatio,
    };
  }

  if (C <= MANDATORIUM_TRANSITION_TOP) {
    const transitionSpan = MANDATORIUM_TRANSITION_TOP - MANDATORIUM_LOW_CEILING;
    const progress = (C - MANDATORIUM_LOW_CEILING) / transitionSpan;
    const targetRatio = MANDATORIUM_LOW_RATIO_AT_CEILING + progress * (MANDATORIUM_TRANSITION_RATIO_AT_TOP - MANDATORIUM_LOW_RATIO_AT_CEILING);
    const seats = ceilDiv(C, Math.round(targetRatio));

    return {
      regime: 'LM (65M→90M transition)',
      totalSeats: Math.max(1, seats),
      C0: MANDATORIUM_C0,
      S0: MANDATORIUM_S0,
      C1: MANDATORIUM_C1,
      C2: MANDATORIUM_C2,
      S1,
      S2,
      Rmid: MANDATORIUM_RMID,
      Rhi: MANDATORIUM_RHI,
      targetRatio,
    };
  }

  if (C <= MANDATORIUM_C2) {
    return {
      regime: 'M (300k band)',
      totalSeats: ceilDiv(C, MANDATORIUM_RMID),
      C0: MANDATORIUM_C0,
      S0: MANDATORIUM_S0,
      C1: MANDATORIUM_C1,
      C2: MANDATORIUM_C2,
      S1,
      S2,
      Rmid: MANDATORIUM_RMID,
      Rhi: MANDATORIUM_RHI,
    };
  }

  const extra = Math.ceil((C - MANDATORIUM_C2) / MANDATORIUM_RHI);
  return {
    regime: 'H (gentle high)',
    totalSeats: S2 + extra,
    C0: MANDATORIUM_C0,
    S0: MANDATORIUM_S0,
    C1: MANDATORIUM_C1,
    C2: MANDATORIUM_C2,
    S1,
    S2,
    Rmid: MANDATORIUM_RMID,
    Rhi: MANDATORIUM_RHI,
    extraSeatsAboveC2: extra,
  };
};

const calcMandatorium = (citizens) => {
  const seatInfo = mandatoriumSeatCount(citizens);

  const S = seatInfo.totalSeats;
  const S_L = Math.round(0.3 * S);
  const S_D = S - S_L;

  const { magnitudeCounts, constituencyCount, note } = chooseStvPlan(S_D);

  return {
    citizens,

    regime: seatInfo.regime,
    C0: seatInfo.C0,
    S0: seatInfo.S0,
    C1: seatInfo.C1,
    C2: seatInfo.C2,
    S1: seatInfo.S1,
    S2: seatInfo.S2,
    Rmid: seatInfo.Rmid,
    Rhi: seatInfo.Rhi,
    slopeSeatsPerCitizen: seatInfo.slopeSeatsPerCitizen,
    extraSeatsAboveC2: seatInfo.extraSeatsAboveC2,

    totalMandators: S,
    citizensPerMandatorOverall: S > 0 ? citizens / S : Infinity,

    prSeats: S_L,
    prConstituencies: 1,
    citizensPerPrSeat: S_L > 0 ? citizens / S_L : Infinity,
    citizensPerPrConstituency: citizens,

    stvSeats: S_D,
    stvConstituencies: constituencyCount,
    stvPlanNote: note,
    stvMagnitudeCounts: magnitudeCounts,
    stvTargets: stvTargetsByMagnitude(citizens, S_D, magnitudeCounts),
  };
};

const ascendiumAllocation = (N) => {
  if (N >= 200) {
    const H = 33;
    let D = Math.max(33, Math.floor((N - 34) / 5));
    let V = 2 * D;
    let P = N - (H + D + V);

    while (P <= V && D > 33) {
      D -= 1;
      V = 2 * D;
      P = N - (H + D + V);
    }

    return { P, V, D, H, regime: 'A (N >= 200)' };
  }

  const H0 = Math.floor(N / 6);
  const D = H0;
  const V = 2 * D;
  const P0 = N - 4 * H0;

  let H;
  let P;

  if (P0 > V) {
    H = H0;
    P = P0;
  } else {
    const k = (V - P0) + 1;
    H = H0 - k;
    P = P0 + k;
  }

  if (H < 0) {
    throw new Error('Ascendium constraints overdetermined for this N. Increase N.');
  }

  return { P, V, D, H, regime: 'B (N < 200)' };
};

const calcAscendium = (citizens, votingSeats) => {
  const { P, V, D, H, regime } = ascendiumAllocation(votingSeats);
  const { magnitudeCounts, constituencyCount, note } = chooseStvPlan(P);
  const initialD = Math.max(33, Math.floor((votingSeats - 34) / 5));

  return {
    citizens,
    votingSeats,
    regime,
    popularSeats: P,
    vocationalSeats: V,
    diarchicSeats: D,
    hereditarySeats: H,
    regimeASafetyReduction: votingSeats >= 200 ? Math.max(0, initialD - D) : 0,
    h0Base: votingSeats < 200 ? Math.floor(votingSeats / 6) : null,
    p0Base: votingSeats < 200 ? votingSeats - 4 * Math.floor(votingSeats / 6) : null,
    transferToPopular: votingSeats < 200 ? Math.max(0, (2 * Math.floor(votingSeats / 6)) - (votingSeats - 4 * Math.floor(votingSeats / 6)) + 1) : 0,
    citizensPerPopularSeat: P > 0 ? citizens / P : Infinity,
    popularStvConstituencies: constituencyCount,
    popularStvPlanNote: note,
    popularStvMagnitudeCounts: magnitudeCounts,
    popularStvTargets: stvTargetsByMagnitude(citizens, P, magnitudeCounts),
  };
};

const format = (n, digits = 0) => Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });

const metricCard = (label, value) => `<article class="metric"><div class="label">${label}</div><div class="value">${value}</div></article>`;

const targetTable = (targets) => {
  const rows = Object.entries(targets)
    .map(([mag, data]) => `
      <tr>
        <td>${mag}</td>
        <td>${format(data.count)}</td>
        <td>${format(data.targetPopulationPerConstituency)}</td>
        <td>${format(data.citizensPerStvSeat, 2)}</td>
      </tr>
    `)
    .join('');

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Magnitude (seats)</th>
            <th>Constituency count</th>
            <th>Target population / constituency</th>
            <th>Citizens per STV seat</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
};

const renderMandatorium = (result) => {
  summaryEl.innerHTML = [
    metricCard('Seat-count regime', result.regime),
    metricCard('Total Mandators (S)', format(result.totalMandators)),
    metricCard('PR Seats (S_L)', format(result.prSeats)),
    metricCard('STV Seats (S_D)', format(result.stvSeats)),
    metricCard('STV Constituencies', format(result.stvConstituencies)),
    metricCard('Citizens / Mandator', format(result.citizensPerMandatorOverall, 2)),
    metricCard('Citizens / PR Seat', Number.isFinite(result.citizensPerPrSeat) ? format(result.citizensPerPrSeat, 2) : '∞'),
  ].join('');

  const regimeExplanation = result.regime === 'L (progressive low ratio)'
    ? `Regime L applies a progressive low-population ratio for C=${format(result.citizens)} up to ${format(MANDATORIUM_LOW_CEILING)} with a gentle slope below ${format(MANDATORIUM_LOW_CEILING)}. The target citizens-per-mandator ratio decreases gradually (around ${format(result.targetRatio || 0, 2)} at this population), then seats are computed as ceil(C / ratio) = ${format(result.totalMandators)}.`
    : result.regime === 'LM (65M→90M transition)'
      ? `Regime LM applies the transition band from ${format(MANDATORIUM_LOW_CEILING)} to ${format(MANDATORIUM_TRANSITION_TOP)} citizens. In this segment the ratio rises toward ${format(MANDATORIUM_TRANSITION_RATIO_AT_TOP)} citizens/seat (around ${format(result.targetRatio || 0, 2)} here), giving ${format(result.totalMandators)} seats.`
      : result.regime.startsWith('M')
        ? `Regime M applies the middle band rule directly: ceil(C / ${format(result.Rmid)}) = ${format(result.totalMandators)} seats.`
        : `Regime H applies the high segment: start from S2=${format(result.S2)} at C2=${format(result.C2)} and add ${format(result.extraSeatsAboveC2 || 0)} seat(s) using ceil((C - C2) / ${format(result.Rhi)}), for a total of ${format(result.totalMandators)} seats.`;

  detailsEl.innerHTML = `
    <div class="callout">
      <strong>Explanation</strong><br>
      ${regimeExplanation}<br><br>
      PR seats are the proportional-representation list seats (30% of total Mandators, rounded half up), while STV seats are elected through constituency contests. Magnitude means the number of STV seats assigned to one constituency: larger magnitudes elect more representatives per district.
    </div>

    <details class="details-block">
      <summary>Audit trail</summary>
      <div class="details-content">
        <strong>C0 / S0 anchor:</strong> ${format(result.C0)} citizens → ${format(result.S0)} seats<br>
        <strong>Kink 1 (C1 / S1):</strong> ${format(result.C1)} citizens → ${format(result.S1)} seats<br>
        <strong>Kink 2 (C2 / S2):</strong> ${format(result.C2)} citizens → ${format(result.S2)} seats<br>
        <strong>Middle ratio (Rmid):</strong> ${format(result.Rmid)} citizens/seat<br>
        <strong>High ratio (Rhi):</strong> ${format(result.Rhi)} citizens/seat
      </div>
    </details>

    <details class="details-block">
      <summary>STV constituency plan</summary>
      <div class="details-content">
        <strong>Plan note:</strong> ${result.stvPlanNote}<br>
        <strong>Magnitude distribution:</strong> ${describeMagnitudes(result.stvMagnitudeCounts)}
        ${targetTable(result.stvTargets)}
      </div>
    </details>
  `;
};

const renderAscendium = (result) => {
  summaryEl.innerHTML = [
    metricCard('Regime', result.regime),
    metricCard('Popular Seats (P)', format(result.popularSeats)),
    metricCard('Vocational Seats (V)', format(result.vocationalSeats)),
    metricCard('Diarchic Seats (D)', format(result.diarchicSeats)),
    metricCard('Hereditary Seats (H)', format(result.hereditarySeats)),
    metricCard('Citizens / Popular Seat', Number.isFinite(result.citizensPerPopularSeat) ? format(result.citizensPerPopularSeat, 2) : '∞'),
  ].join('');

  const regimeExplanation = result.regime.startsWith('A')
    ? `Regime A applies because N=${format(result.votingSeats)} is at least 200. Hereditary seats are fixed at H=33. Diarchic seats begin from the growth rule and vocational seats are set to V=2D. The safety correction ${result.regimeASafetyReduction > 0 ? `reduced D by ${format(result.regimeASafetyReduction)} to keep Popular seats greater than Vocational seats` : 'was not needed in this case'}. Final blocs are P=${format(result.popularSeats)}, V=${format(result.vocationalSeats)}, D=${format(result.diarchicSeats)}, H=${format(result.hereditarySeats)}.`
    : `Regime B applies because N=${format(result.votingSeats)} is below 200. The base is H0=floor(N/6)=${format(result.h0Base)}, then D=H0 and V=2D. Base Popular seats are P0=${format(result.p0Base)}; ${result.p0Base > result.vocationalSeats ? 'no transfer from hereditary seats was required' : `a transfer of ${format(result.transferToPopular)} seat(s) from Hereditary to Popular was applied to force P>V`}. If this transfer would push hereditary seats below zero, the calculator returns an error instructing users to increase N.`;

  detailsEl.innerHTML = `
    <div class="callout">
      <strong>Explanation</strong><br>
      ${regimeExplanation}<br><br>
      This calculator allocates bloc sizes only; it does not predict who wins elections inside each bloc.
    </div>

    <details class="details-block" open>
      <summary>Popular-seat planning aid (STV)</summary>
      <div class="details-content">
        <strong>Popular STV plan:</strong> ${result.popularStvPlanNote}<br>
        <strong>Magnitudes:</strong> ${describeMagnitudes(result.popularStvMagnitudeCounts)}
        ${targetTable(result.popularStvTargets)}
      </div>
    </details>
  `;
};

const getMode = () => modeInputs.find((r) => r.checked)?.value || 'mandatorium';

const updateModeUi = () => {
  const isAsc = getMode() === 'ascendium';
  votingSeatsField.hidden = !isAsc;
  votingSeatsInput.required = isAsc;
};

modeInputs.forEach((input) => input.addEventListener('change', updateModeUi));
updateModeUi();

sampleBtn.addEventListener('click', () => {
  citizensInput.value = 450000000;
  votingSeatsInput.value = getMode() === 'ascendium' ? 200 : '';
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  errorEl.textContent = '';

  const mode = getMode();
  const citizens = Number(citizensInput.value);

  if (!Number.isInteger(citizens) || citizens < 1 || citizens > MAX_CITIZENS) {
    errorEl.textContent = `Please enter a valid integer for total citizens (1 to ${format(MAX_CITIZENS)}).`;
    resultsEl.hidden = true;
    return;
  }

  try {
    if (mode === 'mandatorium') {
      const result = calcMandatorium(citizens);
      renderMandatorium(result);
    } else {
      const votingSeats = Number(votingSeatsInput.value);
      if (!Number.isInteger(votingSeats) || votingSeats < 1) {
        throw new Error('Please enter a valid integer for Ascendium voting seats (N).');
      }
      if (votingSeats > MAX_ASCENDIUM_VOTING_SEATS) {
        throw new Error(`Ascendium voting seats (N) must be ${format(MAX_ASCENDIUM_VOTING_SEATS)} or fewer.`);
      }
      const result = calcAscendium(citizens, votingSeats);
      renderAscendium(result);
    }
    resultsEl.hidden = false;
  } catch (err) {
    errorEl.textContent = err.message || 'Calculation failed. Please check your values.';
    resultsEl.hidden = true;
  }
});

const menuBtn = document.getElementById('menu-btn');
const drawer = document.getElementById('nav-drawer');
const backdrop = document.getElementById('drawer-backdrop');
const closeDrawerBtn = document.getElementById('close-drawer');
let lastFocused = null;
let trapFocusActive = false;

const trapFocus = (event) => {
  if (event.key !== 'Tab' || drawer.getAttribute('aria-hidden') === 'true') return;
  const focusables = [...drawer.querySelectorAll('a, button, [tabindex]:not([tabindex="-1"])')];
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
};

const handleEscKey = (event) => {
  if (event.key === 'Escape' && drawer.getAttribute('aria-hidden') === 'false') closeDrawer();
};

const closeDrawer = () => {
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  backdrop.hidden = true;
  menuBtn.setAttribute('aria-expanded', 'false');
  if (trapFocusActive) {
    document.removeEventListener('keydown', trapFocus);
    trapFocusActive = false;
  }
  if (lastFocused) lastFocused.focus();
};

const openDrawer = () => {
  lastFocused = document.activeElement;
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  backdrop.hidden = false;
  menuBtn.setAttribute('aria-expanded', 'true');
  const firstLink = drawer.querySelector('a, button');
  if (firstLink) firstLink.focus();
  if (!trapFocusActive) {
    document.addEventListener('keydown', trapFocus);
    trapFocusActive = true;
  }
};

if (menuBtn && drawer && backdrop && closeDrawerBtn) {
  menuBtn.addEventListener('click', openDrawer);
  closeDrawerBtn.addEventListener('click', closeDrawer);
  backdrop.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', handleEscKey);
}

/**
 * testClient.js
 * Automated 5-scenario test suite for Node.js Vision Agent Server.
 */

const BASE_URL = 'http://localhost:8000';

async function postJson(endpoint, body) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res;
}

async function runTestCase(name, taskGoal, screenContextBuilder, expectError = false) {
  console.log(`\n==================================================`);
  console.log(` TEST CASE: ${name}`);
  console.log(` Goal: '${taskGoal}'`);
  console.log(`==================================================`);

  let sessionId;
  try {
    const startResp = await postJson('/session/start', { task_goal: taskGoal });
    if (!startResp.ok) throw new Error(`HTTP ${startResp.status}`);
    const data = await startResp.json();
    sessionId = data.session_id;
    console.log(`[+] Session Started: ${sessionId}`);
  } catch (err) {
    console.log(`[-] Failed to start session: ${err.message}`);
    return false;
  }

  const context = screenContextBuilder(sessionId, taskGoal);

  const t0 = Date.now();
  let analyzeResp = await postJson('/context/analyze', context);

  // If server reloaded, retry once
  if (analyzeResp.status === 404) {
    const startResp = await postJson('/session/start', { task_goal: taskGoal });
    if (startResp.ok) {
      const data = await startResp.json();
      sessionId = data.session_id;
      const retryContext = screenContextBuilder(sessionId, taskGoal);
      analyzeResp = await postJson('/context/analyze', retryContext);
    }
  }

  const latency = Date.now() - t0;
  let success = false;

  if (expectError) {
    if (analyzeResp.status === 422) {
      const errData = await analyzeResp.json();
      console.log(`[PASS] Server correctly rejected request with HTTP 422 PII Guard error!`);
      console.log(`       Detail: ${errData.detail}`);
      success = true;
    } else {
      console.log(`[FAIL] Expected HTTP 422 but got ${analyzeResp.status}`);
    }
  } else {
    if (analyzeResp.ok) {
      const result = await analyzeResp.json();
      const action = result.action || {};
      console.log(`[PASS] Model returned valid action in ${latency}ms`);
      console.log(`       Action Type : ${action.action}`);
      console.log(`       Target ID   : ${action.target_element_id}`);
      console.log(`       Value Source: ${action.value_source}`);
      console.log(`       Reasoning   : ${action.reasoning}`);
      success = true;
    } else {
      const text = await analyzeResp.text();
      console.log(`[FAIL] Server error HTTP ${analyzeResp.status}: ${text}`);
    }
  }

  await postJson('/session/end', { session_id: sessionId });
  console.log(`[+] Session Closed Cleanly`);
  return success;
}

function testScenario1(sessionId, taskGoal) {
  return {
    session_id: sessionId,
    task_goal: taskGoal,
    url_domain: 'example.com',
    elements: [
      { id: 'el_1', type: 'input', label: 'Email', value: '[REDACTED_EMAIL]', bbox: [120, 180, 300, 40], redacted: true, redaction_type: 'PII_EMAIL' },
      { id: 'el_2', type: 'input', label: 'Password', value: '[REDACTED_SECRET]', bbox: [120, 230, 300, 40], redacted: true, redaction_type: 'SECRET_PASSWORD' },
      { id: 'el_3', type: 'button', label: 'Sign In', value: null, bbox: [120, 280, 100, 40], redacted: false, redaction_type: null },
    ],
    redaction_manifest: { el_1: 'PII_EMAIL', el_2: 'SECRET_PASSWORD' },
  };
}

function testScenario2(sessionId, taskGoal) {
  return {
    session_id: sessionId,
    task_goal: taskGoal,
    url_domain: 'shop.example.com',
    elements: [
      { id: 'card_input_1', type: 'input', label: 'Credit Card Number', value: '', bbox: [200, 300, 400, 45], redacted: false },
      { id: 'cvv_input_2', type: 'input', label: 'CVV Code', value: '', bbox: [200, 360, 100, 45], redacted: false },
      { id: 'pay_btn', type: 'button', label: 'Pay $49.99', value: null, bbox: [200, 420, 150, 50], redacted: false },
    ],
    redaction_manifest: {},
  };
}

function testScenario3(sessionId, taskGoal) {
  return {
    session_id: sessionId,
    task_goal: taskGoal,
    url_domain: 'booking.example.com',
    elements: [
      { id: 'header_msg', type: 'heading', label: 'Booking Confirmed! Confirmation #982341', value: 'Your hotel reservation is complete.', bbox: [100, 100, 600, 50], redacted: false },
      { id: 'home_btn', type: 'button', label: 'Return to Dashboard', value: null, bbox: [100, 200, 200, 40], redacted: false },
    ],
    redaction_manifest: {},
  };
}

function testScenario4(sessionId, taskGoal) {
  return {
    session_id: sessionId,
    task_goal: taskGoal,
    url_domain: 'unsafe-client.example.com',
    elements: [
      { id: 'unredacted_field', type: 'input', label: 'User Email', value: 'john.doe@example.com', bbox: [100, 100, 300, 40], redacted: false },
    ],
    redaction_manifest: {},
  };
}

function testScenario5(sessionId, taskGoal) {
  return {
    session_id: sessionId,
    task_goal: taskGoal,
    url_domain: 'news.example.com',
    elements: [
      { id: 'top_banner', type: 'header', label: 'Breaking News Article Header', value: 'Scroll down to read the privacy disclaimer at the footer.', bbox: [0, 0, 1200, 200], redacted: false },
    ],
    redaction_manifest: {},
  };
}

async function main() {
  console.log('==================================================');
  console.log(' Node.js Vision Agent Server - System Test Suite');
  console.log(' Target Server:', BASE_URL);
  console.log('==================================================');

  await new Promise((resolve) => setTimeout(resolve, 1000));

  const results = [];

  results.push([
    '1. Login Form (Click Action)',
    await runTestCase('Pre-filled Login Form', 'Log into the site using saved credentials and click submit', testScenario1),
  ]);

  results.push([
    '2. Checkout Form (Privacy Type Action)',
    await runTestCase('Payment Checkout Form', 'Enter card number to pay for order', testScenario2),
  ]);

  results.push([
    '3. Task Completion (Done Action)',
    await runTestCase('Booking Confirmation Screen', 'Confirm hotel booking and finish task', testScenario3),
  ]);

  results.push([
    '4. Defense PII Guard (HTTP 422 Rejection)',
    await runTestCase('Unredacted PII Detection Guard', 'Process user profile update', testScenario4, true),
  ]);

  results.push([
    '5. Page Navigation (Scroll Action)',
    await runTestCase('Long Article Page', 'Scroll down to find the footer disclaimer', testScenario5),
  ]);

  printSummary(results);
}

function printSummary(results) {
  console.log('\n==================================================');
  console.log(' TEST SUITE SUMMARY');
  console.log('==================================================');
  let passedCount = 0;
  for (const [name, passed] of results) {
    if (passed) passedCount++;
    const status = passed ? '[PASS]' : '[FAIL]';
    console.log(` ${status} : ${name}`);
  }
  console.log(`\n Total Passed: ${passedCount}/${results.length}`);
  console.log('==================================================');
}

main();

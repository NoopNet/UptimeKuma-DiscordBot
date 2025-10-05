<?php
// ======================================================
// 🌐 Uptime Kuma PHP Backend — Coolify Ready (ENV-based)
// ======================================================
// Author: NoopNet (Adrian)
// Version: 1.0.3
// Description:
// - Fetches Uptime Kuma Prometheus metrics via API key
// - Returns clean JSON output for Discord bot or dashboards
// - Uses only environment variables (no config.json)
// ======================================================

// 1️⃣ Load ENV variables (set in Coolify / Docker)
$baseUrl   = getenv('KUMA_URL') ?: '';
$apiKey    = getenv('API_KEY') ?: '';
$debugMode = getenv('DEBUG') ?: false;

// 2️⃣ Basic sanity check
if (empty($baseUrl) || empty($apiKey)) {
    header('Content-Type: application/json; charset=utf-8');
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'error' => 'Missing required environment variables.',
        'required' => ['KUMA_URL', 'API_KEY']
    ], JSON_PRETTY_PRINT);
    exit;
}

// 3️⃣ Healthcheck (for Coolify)
if (isset($_GET['health'])) {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'ok' => true,
        'status' => 'healthy',
        'timestamp' => date('c')
    ]);
    exit;
}

// 4️⃣ Build target metrics URL
$url = rtrim($baseUrl, '/') . '/metrics';
if ($debugMode) error_log("Fetching Uptime Kuma metrics from: $url");

// 5️⃣ Perform cURL request
$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_TIMEOUT => 15,
    CURLOPT_HTTPAUTH => CURLAUTH_BASIC,
    CURLOPT_USERPWD => "$username:$apiKey", // Basic Auth with key
]);
$response = curl_exec($ch);
$httpStatus = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$error = curl_error($ch);
curl_close($ch);

// 6️⃣ If success: Parse Prometheus metrics
if ($httpStatus === 200 && $response) {
    preg_match_all('/monitor_status\{(.*?)\} (\d+)/', $response, $matches, PREG_SET_ORDER);
    $data = [];

    foreach ($matches as $match) {
        $labels = [];
        foreach (explode(',', $match[1]) as $part) {
            $kv = explode('=', $part);
            if (count($kv) === 2) {
                $key = trim($kv[0]);
                $value = trim($kv[1], '"');
                $labels[$key] = $value;
            }
        }
        $data[] = [
            'monitor_name'     => $labels['monitor_name'] ?? null,
            'monitor_type'     => $labels['monitor_type'] ?? null,
            'monitor_url'      => $labels['monitor_url'] ?? null,
            'monitor_hostname' => $labels['monitor_hostname'] ?? null,
            'monitor_port'     => $labels['monitor_port'] ?? null,
            'status'           => (int) $match[2],
        ];
    }

    // 7️⃣ Output as JSON
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'ok' => true,
        'count' => count($data),
        'data' => $data,
        'source' => $url,
        'timestamp' => date('c')
    ], JSON_PRETTY_PRINT);
    exit;
}

// 8️⃣ On error
header('Content-Type: application/json; charset=utf-8');
http_response_code($httpStatus ?: 500);
echo json_encode([
    'ok' => false,
    'error' => 'Failed to fetch data from Uptime Kuma.',
    'details' => $error ?: 'No response received.',
    'status' => $httpStatus,
    'url' => $url
], JSON_PRETTY_PRINT);
exit;
?>

<?php
// ======================================================
// ✅ Uptime Kuma PHP Backend (ENV-based, no hardcoded config)
// ======================================================

// 1️⃣ Lade Environment Variablen (werden in Coolify gesetzt)
$baseUrl  = getenv('KUMA_URL') ?: '';  // Fallback
$apiKey   = getenv('API_KEY') ?: '';                             // Dein API Key
$username = getenv('API_USER') ?: '';                            // optional (Basic Auth Username)

// 2️⃣ Baue Ziel-URL für Kuma-Metrics
$url = rtrim($baseUrl, '/') . '/metrics';

// 3️⃣ Debug-Ausgabe (optional im Container-Log sichtbar)
error_log("Fetching Uptime Kuma metrics from: $url");

// 4️⃣ HTTP-Request mit cURL
$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_TIMEOUT => 10,
    CURLOPT_HTTPAUTH => CURLAUTH_BASIC,
    CURLOPT_USERPWD => "$username:$apiKey", // Auth mit API-Key (oder leer)
]);

$response = curl_exec($ch);
$httpStatus = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

// 5️⃣ Wenn erfolgreich, parse die Kuma-Metriken
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

    // 6️⃣ JSON-Ausgabe für API
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'ok' => true,
        'count' => count($data),
        'data' => $data,
    ], JSON_PRETTY_PRINT);
} else {
    // 7️⃣ Fehlerausgabe
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'ok' => false,
        'error' => 'Failed to fetch data',
        'status' => $httpStatus,
        'url' => $url,
    ], JSON_PRETTY_PRINT);
}
?>

<?php
// Read and decode the config file
// Try multiple possible locations for the config file
$possiblePaths = [
    __DIR__ . '/config.json',           // Same directory
    __DIR__ . '/../config.json',        // One level up
    __DIR__ . '/../../config.json',     // Two levels up
    '/app/config.json'                  // Docker container location
];

$configFile = null;
foreach ($possiblePaths as $path) {
    error_log("Checking for config at: " . $path);
    if (file_exists($path)) {
        $configFile = $path;
        error_log("Found config at: " . $path);
        break;
    }
}

if ($configFile === null) {
    error_log("Config file not found in any of the expected locations");
    die("Config file not found");
}

$config = json_decode(file_get_contents($configFile), true);
if ($config === null) {
    error_log("Failed to parse config JSON: " . json_last_error_msg());
    die("Failed to parse config");
}

$url = $config['urls']['uptimeKumaBase'] . '/metrics'; //your URL
$password = $config['uptimeKumaAPIKey']; //your API key

$username = ''; //leave empty

// Debug: Print the URL being accessed
error_log("Attempting to fetch from URL: " . $url);

// Initialize a new cURL session
$ch = curl_init($url);

// Set cURL options
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true); // Return the transfer as a string
curl_setopt($ch, CURLOPT_HTTPAUTH, CURLAUTH_BASIC); // Use basic HTTP authentication
curl_setopt($ch, CURLOPT_USERPWD, "$username:$password"); // Set username and password for the connection

// Execute the cURL session
$response = curl_exec($ch);

// Get the HTTP status code of the response
$http_status = curl_getinfo($ch, CURLINFO_HTTP_CODE);

// Close the cURL session
curl_close($ch);

// Check if the request was successful
if ($http_status == 200) {
    // Parse the response and extract relevant data
    preg_match_all('/monitor_status\{(.*?)\} (\d+)/', $response, $matches, PREG_SET_ORDER);
    
    $data = [];
    // Loop through each match
    foreach ($matches as $match) {
        $labels = [];
        // Split the match into parts
        $parts = explode(',', $match[1]);
        // Loop through each part
        foreach ($parts as $part) {
            // Split the part into key and value
            list($key, $value) = explode('=', $part);
            // Trim and store the key-value pair
            $labels[trim($key)] = trim($value, '"');
        }
        // Add the parsed data to the data array
        $data[] = [
            'monitor_name' => $labels['monitor_name'],
            'monitor_type' => $labels['monitor_type'],
            'monitor_url' => $labels['monitor_url'],
            'monitor_hostname' => $labels['monitor_hostname'],
            'monitor_port' => $labels['monitor_port'],
            'status' => (int) $match[2]
        ];
    }
        
    // Set the content type of the response to JSON
    header('Content-Type: application/json');
    // Output the data in JSON format
    echo json_encode($data, JSON_PRETTY_PRINT);
} else {
    // Output an error message if the request was not successful
    echo "Failed to fetch data. HTTP Status Code: $http_status";
}
?>

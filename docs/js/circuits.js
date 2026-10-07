// Approximate circuit locations, keyed by OpenF1 circuit/location names. Unknown places are geocoded on demand.
export const CIRCUITS = [
  ['melbourne', -37.8497, 144.968], ['albert park', -37.8497, 144.968], ['shanghai', 31.3389, 121.2197], ['suzuka', 34.8431, 136.541],
  ['sakhir', 26.0325, 50.5106], ['bahrain', 26.0325, 50.5106], ['jeddah', 21.6319, 39.1044], ['miami', 25.9581, -80.2389],
  ['imola', 44.3439, 11.7167], ['monaco', 43.7347, 7.4206], ['monte carlo', 43.7347, 7.4206], ['catalunya', 41.57, 2.2611], ['barcelona', 41.57, 2.2611],
  ['madrid', 40.4637, -3.6166], ['montreal', 45.5, -73.5228], ['spielberg', 47.2197, 14.7647], ['silverstone', 52.0786, -1.0169],
  ['spa', 50.4372, 5.9714], ['hungaroring', 47.5789, 19.2486], ['budapest', 47.5789, 19.2486], ['zandvoort', 52.3888, 4.5409],
  ['monza', 45.6156, 9.2811], ['baku', 40.3725, 49.8533], ['singapore', 1.2914, 103.864], ['marina bay', 1.2914, 103.864],
  ['austin', 30.1328, -97.6411], ['mexico', 19.4042, -99.0907], ['interlagos', -23.7036, -46.6997], ['sao paulo', -23.7036, -46.6997],
  ['las vegas', 36.1147, -115.1728], ['lusail', 25.49, 51.4542], ['losail', 25.49, 51.4542], ['yas marina', 24.4672, 54.6031], ['abu dhabi', 24.4672, 54.6031],
  ['kuala lumpur', 2.7608, 101.7382], ['sepang', 2.7608, 101.7382],
];

export async function circuitLatLon(meeting) {
  const keys = [meeting.circuit_short_name, meeting.location, meeting.country_name].map(x => String(x || '').toLowerCase());
  for (const k of keys) { const hit = CIRCUITS.find(c => k.includes(c[0])); if (hit) return { lat: hit[1], lon: hit[2], name: meeting.circuit_short_name || meeting.location }; }
  try {
    const q = encodeURIComponent(meeting.location || meeting.circuit_short_name || meeting.country_name);
    const j = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${q}&count=1`)).json();
    if (j.results && j.results[0]) return { lat: j.results[0].latitude, lon: j.results[0].longitude, name: meeting.location };
  } catch { /* offline */ }
  return null;
}

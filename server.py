from flask import Flask, jsonify, request
from flask_cors import CORS
import os
from dotenv import load_dotenv
import random
import json
from pathlib import Path
import datetime
import hashlib
import requests
from math import radians, cos, sin, asin, sqrt

from dotenv import find_dotenv
load_dotenv(find_dotenv())

app = Flask(__name__)
CORS(app)

# Boston bounding box (approximate)
# Central Boston bounding box (roughly downtown and surrounding neighborhoods)
BOSTON_BOUNDS = {
    "min_lat": 42.32,   # south boundary ~Jamaica Plain
    "max_lat": 42.39,   # north boundary ~Charlestown
    "min_lng": -71.15,  # west boundary ~Brookline/Allston
    "max_lng": -71.00   # east boundary ~Harbor
}

def random_boston_coordinate():
    """Return a random (lat, lng) located within Boston city bounds."""
    lat = random.uniform(BOSTON_BOUNDS["min_lat"], BOSTON_BOUNDS["max_lat"])
    lng = random.uniform(BOSTON_BOUNDS["min_lng"], BOSTON_BOUNDS["max_lng"])
    return lat, lng

def get_street_view_image_url(lat: float, lng: float, width: int = 600, height: int = 400, radius: int = 0) -> str:
    """Generate a Google Street View Static API URL for the given coordinate.
    Falls back to no key if GOOGLE_MAPS_API_KEY is absent."""
    api_key = os.getenv("GOOGLE_MAPS_API_KEY", "")
    base_url = "https://maps.googleapis.com/maps/api/streetview"
    params = f"size={width}x{height}&location={lat},{lng}&pitch=0&fov=90"
    if radius:
        params += f"&radius={radius}"
    if api_key:
        params += f"&key={api_key}"
    return f"{base_url}?{params}"

def calculate_distance(lat1, lon1, lat2, lon2):
    """
    Calculate the great circle distance between two points 
    on the earth (specified in decimal degrees)
    """
    # convert decimal degrees to radians 
    lon1, lat1, lon2, lat2 = map(radians, [lon1, lat1, lon2, lat2])
    
    # haversine formula 
    dlon = lon2 - lon1 
    dlat = lat2 - lat1 
    a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
    c = 2 * asin(sqrt(a)) 
    r = 6371 # Radius of earth in kilometers
    return c * r

CACHE_FILE = Path(__file__).with_name('daily_location.json')

@app.route('/api/get-location', methods=['GET'])
def get_location():
    """Return a random Boston coordinate with a Google Street View static image."""
    today = datetime.date.today().isoformat()

    if CACHE_FILE.exists():
        try:
            data = json.loads(CACHE_FILE.read_text())
            if data.get('date') == today:
                return jsonify(data['payload'])
        except Exception:
            pass  # fall through to regenerate

    # deterministic seed per day to avoid repeat due to server running long
    random.seed(int(hashlib.sha256(today.encode()).hexdigest(),16) & 0xffffffff)
    lat, lng = random_boston_coordinate()
    image_url = get_street_view_image_url(lat, lng, width=640, height=400, radius=300)
    payload = {
        'image': image_url,
        'name': 'Street View',
        'lat': lat,
        'lng': lng
    }
    CACHE_FILE.write_text(json.dumps({'date': today, 'payload': payload}))
    return jsonify(payload)

@app.route('/api/check-distance', methods=['POST'])
def check_distance():
    data = request.json
    target_lat = data['target_lat']
    target_lng = data['target_lng']
    user_lat = data['user_lat']
    user_lng = data['user_lng']
    
    distance = calculate_distance(target_lat, target_lng, user_lat, user_lng)
    return jsonify({
        'distance': round(distance, 2),
        'unit': 'km'
    })

if __name__ == '__main__':
    app.run(debug=True, port=5000)

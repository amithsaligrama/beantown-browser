import React, { useState, useRef, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';


// Remove the default icon warning
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

const Game = () => {
  const [currentLocation, setCurrentLocation] = useState(null);
  const mapRef = useRef(null);
  const [userPosition, setUserPosition] = useState(null); // last guess
  const [guesses, setGuesses] = useState([]); // {latlng, distance}

  const [distance, setDistance] = useState(null);
  
  const [feedback, setFeedback] = useState(''); // textual hint
  const [imageExpanded, setImageExpanded] = useState(false);
  const [countdown, setCountdown] = useState('');
  const [revealAnswer, setRevealAnswer] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  const ClickHandler = () => {
    useMapEvents({
      click: (e) => {
        if (!revealAnswer) {
          handleMapClick(e);
        }
      },
    });
    return null;
  };

  const fetchDailyLocation = async () => {
    try {
      const response = await fetch('http://localhost:5000/api/get-location');
      if (!response.ok) throw new Error('Network response was not ok');
      const data = await response.json();
      setCurrentLocation(data);
      
      setUserPosition(null);
      setGuesses([]);
      setFeedback('');
      setDistance(null);
      setRevealAnswer(false);
      // reset map view
      if (mapRef.current) {
        mapRef.current.setView([42.3601, -71.0589], 13);
      }
    } catch (error) {
      console.error('Error fetching location:', error);
    }
  };

  /* ----- effects ----- */
  useEffect(()=>{
    // initial fetch
    fetchDailyLocation();
  },[]);

  useEffect(()=>{
    const updateCountdown = ()=>{
      const now = new Date();
      const next = new Date();
      next.setHours(24,0,0,0);
      const diff = next - now;
      const h = String(Math.floor(diff/3600000)).padStart(2,'0');
      const m = String(Math.floor((diff%3600000)/60000)).padStart(2,'0');
      const s = String(Math.floor((diff%60000)/1000)).padStart(2,'0');
      setCountdown(`${h}:${m}:${s}`);
    };
    updateCountdown();
    const id=setInterval(updateCountdown,1000);
    return ()=>clearInterval(id);
  },[]);

  const shareSymbols = {
    blue:'🟦', yellow:'🟨', orange:'🟧', red:'🟥', green:'🟩'
  };
  const arrowFromDir = {
    'north':'⬆️','south':'⬇️','east':'➡️','west':'⬅️',
    'north-east':'↗️','north-west':'↖️','south-east':'↘️','south-west':'↙️','':'⬜'
  };

  const handleShare = () => {
    const todayIndex = Math.floor(Date.now()/86400000);
    let text = `Beantown Browser #${todayIndex}\nWhere do you think this picture was taken?\n`;
    guesses.forEach((g,idx)=>{
      const color = getColor(g.distance);
      const sym = shareSymbols[color]||'⬜';
      const dir = directionFromGuess({lat:currentLocation.lat,lng:currentLocation.lng}, g.latlng);
      const arrow = revealAnswer && idx===guesses.length-1 && distance<=WIN_THRESHOLD_KM? '' : (arrowFromDir[dir]||'');
      text += `${sym}${arrow}\n`;
    });
    text += '\nhttps://beantownbrowser.com';
    navigator.clipboard.writeText(text).then(()=> setShareCopied(true));
  };

  const MAX_GUESSES = 5;
  const WIN_THRESHOLD_KM = 0.1524; // 500 ft ≈ 0.1524 km

  const directionFromGuess = (target, guess) => {
    const latDiff = target.lat - guess.lat;
    const lngDiff = target.lng - guess.lng;
    const absLat = Math.abs(latDiff);
    const absLng = Math.abs(lngDiff);
    const THRESH = 0.0003; // ~30 m
    // If both differences are tiny, user is very close
    if (absLat < THRESH && absLng < THRESH) return 'very close';

    // Decide dominant axis. If one axis difference is 1.5× the other, prefer that axis only.
    const dominantLat = absLat > absLng * 1.5;
    const dominantLng = absLng > absLat * 1.5;

    let parts = [];
    if (!dominantLng && absLat >= THRESH) parts.push(latDiff > 0 ? 'north' : 'south');
    if (!dominantLat && absLng >= THRESH) parts.push(lngDiff > 0 ? 'east' : 'west');

    return parts.join('-');
  };

  const getColor = (km) => {
    if (km === null || km === undefined) return 'gray';
    if (km <= WIN_THRESHOLD_KM) return 'green'; // correct within 500 ft
    if (km <= 0.3) return 'red';          // very close (< 0.3 km ~ 1000 ft)
    if (km <= 1)   return 'orange';       // closer (< 1 km)
    if (km <= 2)   return 'yellow';       // less far (< 2 km)
    return 'blue';                        // far
  };
  

  const memoizedIcons = {};
  const getIcon = (color) => {
    if (memoizedIcons[color]) return memoizedIcons[color];
    memoizedIcons[color] = L.divIcon({
      className: 'custom-marker',
      html: `<div style="background:${color};width:16px;height:16px;border-radius:50%;border:2px solid white"></div>`
    });
    return memoizedIcons[color];
  };

  const formatDistance = (km) => {
    const miles = km * 0.621371;
    if (miles >= 1) return `${miles.toFixed(2)} miles`;
    const feet = km * 3280.84;
    return `${Math.round(feet)} ft`;
  };

  const handleMapClick = (e) => {
    if (revealAnswer || guesses.length >= MAX_GUESSES) return;
    setUserPosition(e.latlng);
    const guessIdx = guesses.length;
    setGuesses(prev => [...prev, { latlng: e.latlng, distance: null }]);
    
    if (currentLocation) {
            fetch('http://localhost:5000/api/check-distance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_lat: currentLocation.lat,
          target_lng: currentLocation.lng,
          user_lat: e.latlng.lat,
          user_lng: e.latlng.lng
        })
      })
      .then(res => res.json())
      .then(data => {
        // update distance for this guess
        setGuesses(prev => prev.map((g,i)=> i===guessIdx ? {...g, distance:data.distance}: g));

        if (data.distance <= WIN_THRESHOLD_KM) {
          setDistance(data.distance);
          setFeedback('Correct!');
          setRevealAnswer(true);
        } else if (guesses.length + 1 >= MAX_GUESSES) {
          setDistance(data.distance);
          setFeedback('Out of guesses! Revealing answer.');
          setRevealAnswer(true);
        } else {
          const dir = directionFromGuess({ lat: currentLocation.lat, lng: currentLocation.lng }, e.latlng);
          setFeedback(`Try a bit more ${dir}.`);
        }
      })
      .catch(err => console.error('Error checking distance:', err));

    }
  };

  return (
    <div className="game-container">
      <div className="game-header">
        <h1>Beantown Browser</h1>
        <div className="countdown">Next puzzle in {countdown}</div>
      </div>

      {feedback && !revealAnswer && (
        <div className="hint-overlay">{feedback}</div>
      )}

      <MapContainer 
        whenCreated={(map)=>{mapRef.current = map;}}
        center={[42.3601, -71.0589]} 
        zoom={13}
        style={{ height: '100vh', width: '100vw' }}
      >
        <ClickHandler />
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
        
        {revealAnswer && currentLocation && (
          <Marker position={[currentLocation.lat, currentLocation.lng]}>
            <Popup>
              {currentLocation.name}
            </Popup>
          </Marker>
        )}

        {guesses.map((g, idx) => (
          <Marker key={idx} position={g.latlng} icon={getIcon(getColor(g.distance))}>
            <Popup>
              {`Guess #${idx + 1}`}
              {revealAnswer && g.distance !== undefined && (
                <p>Distance: {formatDistance(g.distance)}</p>
              )}
            </Popup>
          </Marker>
        ))}


        {/* dashed line after game ends */}
        {revealAnswer && userPosition && (
          <Polyline
            positions={[userPosition, [currentLocation.lat, currentLocation.lng]]}
            pathOptions={{ color: 'red', dashArray: '6' }}
          />
        )}
      </MapContainer>

      {currentLocation && (
        <>
          {!imageExpanded && (
            <img
              src={currentLocation.image}
              alt="location thumbnail"
              className="thumbnail-img"
              onClick={() => setImageExpanded(true)}
            />
          )}
          {imageExpanded && (
            <div className="img-overlay" onClick={() => setImageExpanded(false)}>
              <img
                src={currentLocation.image}
                alt="location"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}
        </>
      )}

      {revealAnswer && (
        <div className="distance-info" style={{ marginTop: '15px' }}>
          <h3>{feedback}</h3>
          {distance !== null && <p>You were {formatDistance(distance)} away</p>}
          <button onClick={handleShare} style={{marginTop:'10px'}}>Share</button>
          {shareCopied && <span style={{marginLeft:'8px'}}>Copied!</span>}
        </div>
      )}
    </div>
  );
};

export default Game;

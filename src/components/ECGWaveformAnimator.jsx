

import { useEffect, useRef, useState } from 'react';


const ECGWaveformAnimator = () => {
  const svgRef = useRef(null);
  
  const [params, setParams] = useState({
    heart_rate: 70,
    pixelsPerMv: 100,
    
    h_p: 0.15,
    b_p: 0.08,
    h_q: -0.1,
    b_q: 0.025,
    h_r: 1.2,
    b_r: 0.05,
    h_s: -0.25,
    b_s: 0.025,
    h_t: 0.2,
    b_t: 0.16,
    
    l_pq: 0.08,
    l_st: 0.12,
    l_tp: 0.3,
    n_p: 1,
    
    rWaveEnabled: false,
    rWaveCount: 2,
    rWaveInterval: 5,
    pWaveEnabled: false,
    pWaveCount: 0,
    pWaveInterval: 3,
    
    useCustomBeatParameters: false,
    repeatInterval: 10
  });
  
  const [customBeatsParameters, setCustomBeatsParameters] = useState([]);
  
  const globalCounters = useRef({
    beatCounter: 0,
    rWaveCounter: 0,
    pWaveCounter: 0,
    customBeatIndex: 0,
  });

  const animationRef = useRef(null);
  const lastTimestampRef = useRef(0);
  const pointerXRef = useRef(0);
  const firstSweepRef = useRef(true);
  const pathPointsRef = useRef([]);
  const drawnPointsRef = useRef([]);
  const waveformPathRef = useRef(null);
  const gridGroupRef = useRef(null);
  const pointerHeadRef = useRef(null);

  const PIXELS_PER_SECOND = 150;
  const POINTER_RADIUS = 6;
  const ERASE_WIDTH = 12;

  const handleInputChange = (e) => {
    const { id, value, type, checked } = e.target;
    setParams(prev => ({
      ...prev,
      [id]: type === 'checkbox' ? checked : type === 'number' ? parseFloat(value) : value
    }));
  };

  const addCustomBeat = () => {
    setCustomBeatsParameters(prev => [
      ...prev, 
      {
        h_p: 0.15, b_p: 0.08, h_q: -0.1, b_q: 0.025, h_r: 1.2, b_r: 0.05,
        h_s: -0.25, b_s: 0.025, h_t: 0.2, b_t: 0.16,
        l_pq: 0.08, l_st: 0.12, l_tp: 0.3
      }
    ]);
  };

  const removeCustomBeat = (index) => {
    setCustomBeatsParameters(prev => prev.filter((_, i) => i !== index));
  };

  const handleCustomBeatChange = (index, param, value) => {
    setCustomBeatsParameters(prev => {
      const newBeats = [...prev];
      newBeats[index] = { ...newBeats[index], [param]: parseFloat(value) };
      return newBeats;
    });
  };

  const raisedCosinePulse = (t, h, b, t0) => {
    if (b === 0 || t < t0 || t > t0 + b) return 0;
    return (h / 2) * (1 - Math.cos((2 * Math.PI * (t - t0)) / b));
  };

  const drawGridSVG = () => {
    if (!svgRef.current) return;
    
    const svg = svgRef.current;
    let gridGroup = gridGroupRef.current;
    
    if (gridGroup) {
      gridGroup.innerHTML = "";
    } else {
      gridGroup = document.createElementNS(svg.namespaceURI, "g");
      gridGroupRef.current = gridGroup;
      svg.appendChild(gridGroup);
    }
    
    const small = 8, large = small * 5;
    const width = svg.width.baseVal.value;
    const height = svg.height.baseVal.value;
    
    for (let x = 0; x <= width; x += small) {
      const line = document.createElementNS(svg.namespaceURI, "line");
      line.setAttribute("x1", x);
      line.setAttribute("y1", 0);
      line.setAttribute("x2", x);
      line.setAttribute("y2", height);
      line.setAttribute("stroke", "#eee");
      gridGroup.appendChild(line);
    }
    
    for (let y = 0; y <= height; y += small) {
      const line = document.createElementNS(svg.namespaceURI, "line");
      line.setAttribute("x1", 0);
      line.setAttribute("y1", y);
      line.setAttribute("x2", width);
      line.setAttribute("y2", y);
      line.setAttribute("stroke", "#eee");
      gridGroup.appendChild(line);
    }
  };

  const generateWaveformPoints = () => {
    if (!svgRef.current) return [];
    
    const svg = svgRef.current;
    const totalTime = svg.width.baseVal.value / PIXELS_PER_SECOND;
    const y0 = svg.height.baseVal.value / 2;
    const pts = [];
    const dt = 1 / PIXELS_PER_SECOND;

    let rCycleCounterLocal = globalCounters.current.rCycleCounter;
    let pCycleCounterLocal = globalCounters.current.pCycleCounter;
    let beatCounter = globalCounters.current.beatCounter;
    let customIdx = globalCounters.current.customIdx;
    let waitingNormalBeats = globalCounters.current.waitingNormalBeats;

    let tElapsed = 0;

    while (tElapsed <= totalTime) {
      let pCurrent = { ...params };

      if (params.useCustomBeatParameters) {
        if (customBeatsParameters.length > 0 && waitingNormalBeats === 0) {
          pCurrent = { ...params, ...customBeatsParameters[customIdx] };
          customIdx++;
          if (customIdx >= customBeatsParameters.length) {
            customIdx = 0;
            waitingNormalBeats = params.repeatInterval;
          }
        } else if (waitingNormalBeats > 0) {
          waitingNormalBeats--;
        }
      }

      let curPCount = pCurrent.n_p;
      if (params.pWaveEnabled) {
        pCycleCounterLocal++;
        if (params.pWaveInterval > 0 && pCycleCounterLocal >= params.pWaveInterval) {
          curPCount = params.pWaveCount;
          pCycleCounterLocal = 0;
        }
      }

      let curRCount = 1;
      if (params.rWaveEnabled) {
        rCycleCounterLocal++;
        if (params.rWaveInterval > 0 && rCycleCounterLocal >= params.rWaveInterval) {
          curRCount = params.rWaveCount;
          rCycleCounterLocal = 0;
        }
      }

      const base = curPCount * (pCurrent.b_p + pCurrent.l_pq)
        + (pCurrent.b_q + pCurrent.b_r + pCurrent.b_s) * (curRCount > 0 ? 1 : 0)
        + pCurrent.l_st + pCurrent.b_t + pCurrent.l_tp;

      const heart_period = 60 / (pCurrent.heart_rate || 60);
      const sf = heart_period / base;

      const s = {
        b_p: pCurrent.b_p * sf, l_pq: pCurrent.l_pq * sf,
        b_q: pCurrent.b_q * sf, b_r: pCurrent.b_r * sf,
        b_s: pCurrent.b_s * sf, l_st: pCurrent.l_st * sf,
        b_t: pCurrent.b_t * sf, l_tp: pCurrent.l_tp * sf
      };

      const cycleDuration = curPCount * (s.b_p + s.l_pq)
        + (curRCount > 0 ? (s.b_q + s.b_r + s.b_s) : 0)
        + s.l_st + s.b_t + s.l_tp;

      const times = (() => {
        let off = tElapsed;
        const t = { P: [], Q: 0, R: [], S: [], T: 0 };

        for (let i = 0; i < curPCount; i++) {
          t.P.push(off + i * (s.b_p + s.l_pq));
        }
        off += curPCount * (s.b_p + s.l_pq);

        if (curRCount > 0) {
          for (let i = 0; i < curRCount; i++) {
            t.Q = off;
            off += s.b_q;
            t.R.push(off);
            off += s.b_r;
            t.S.push(off);
            off += s.b_s;
            if (i < curRCount - 1) off += s.l_pq / 2;
          }
        }
        off += s.l_st;
        t.T = off;
        return t;
      })();

      const tEnd = tElapsed + cycleDuration;

      for (let t = tElapsed; t < tEnd; t += dt) {
        let v = 0;
        for (let start of times.P) {
          if (t >= start && t < start + s.b_p) {
            v = raisedCosinePulse(t, pCurrent.h_p, s.b_p, start);
            break;
          }
        }
        if (!v && curRCount > 0 && t >= times.Q && t < times.Q + s.b_q) {
          v = raisedCosinePulse(t, pCurrent.h_q, s.b_q, times.Q);
        }
        if (!v && curRCount > 0) {
          for (let r of times.R) {
            if (t >= r && t < r + s.b_r) {
              v = raisedCosinePulse(t, pCurrent.h_r, s.b_r, r);
              break;
            }
          }
        }
        if (!v && curRCount > 0) {
          for (let sWave of times.S) {
            if (t >= sWave && t < sWave + s.b_s) {
              v = raisedCosinePulse(t, pCurrent.h_s, s.b_s, sWave);
              break;
            }
          }
        }
        if (!v && t >= times.T && t < times.T + s.b_t) {
          v = raisedCosinePulse(t, pCurrent.h_t, s.b_t, times.T);
        }

        pts.push({
          x: t * PIXELS_PER_SECOND,
          y: y0 - v * params.pixelsPerMv
        });
      }

      tElapsed += cycleDuration;
      beatCounter++;
    }

    globalCounters.current = {
      rCycleCounter: rCycleCounterLocal,
      pCycleCounter: pCycleCounterLocal,
      beatCounter: beatCounter,
      customIdx: customIdx,
      waitingNormalBeats: waitingNormalBeats
    };

    return pts;
  };

  /**
   * Converts an array of points to an SVG path string
   * 
   * @param {Array} pts - Array of {x, y} coordinate points
   * @returns {string} 
   */
  const pointsToPath = (pts) => {
    return pts.reduce((str, p, i) => str + (i ? " L" : "M") + ` ${p.x} ${p.y}`, "");
  };

  const initializeSVG = () => {
    if (!svgRef.current) return;
    
    const svg = svgRef.current;
    
    drawGridSVG();
    
    if (waveformPathRef.current) svg.removeChild(waveformPathRef.current);
    const waveformPath = document.createElementNS(svg.namespaceURI, "path");
    waveformPath.setAttribute("stroke", "#2c3e50");
    waveformPath.setAttribute("fill", "none");
    waveformPath.setAttribute("stroke-width", "2");
    svg.appendChild(waveformPath);
    waveformPathRef.current = waveformPath;
    
    // Create or replace the pointer head element
    if (pointerHeadRef.current) svg.removeChild(pointerHeadRef.current);
    const pointerHead = document.createElementNS(svg.namespaceURI, "circle");
    pointerHead.setAttribute("r", POINTER_RADIUS);
    pointerHead.setAttribute("fill", "#fff");
    pointerHead.setAttribute("stroke", "#fff");
    pointerHead.setAttribute("stroke-width", "2");
    svg.appendChild(pointerHead);
    pointerHeadRef.current = pointerHead;
  };

  /**
   * Main animation loop for the ECG waveform
   * 
   * This function is called on each animation frame and handles:
   * 1. Moving the pointer along the waveform
   * 2. Drawing the visible portion of the waveform
   * 3. Handling the sweep animation and continuous scrolling
   * 
   * @param {number} ts - Current timestamp from requestAnimationFrame
   */
  const animationLoop = (ts) => {
    if (!svgRef.current || !waveformPathRef.current || !pointerHeadRef.current) return;
    
    const svg = svgRef.current;
    const waveformPath = waveformPathRef.current;
    const pointerHead = pointerHeadRef.current;
    const w = svg.width.baseVal.value;
    
    const dt = lastTimestampRef.current ? (ts - lastTimestampRef.current) / 1000 : 0;
    lastTimestampRef.current = ts;
    pointerXRef.current += PIXELS_PER_SECOND * dt;

    const pathPoints = pathPointsRef.current;
    let drawnPoints = drawnPointsRef.current;
    
    // Find the current point index based on pointer position
    let idx = pathPoints.findIndex(pt => pt.x >= pointerXRef.current);
    if (idx < 0) idx = pathPoints.length - 1;

    if (firstSweepRef.current) {
      // First sweep mode - draw points up to the current position
      drawnPoints = pathPoints.slice(0, idx + 1);
      waveformPath.setAttribute("d", pointsToPath(drawnPoints));
      
      // Transition to continuous mode when we reach the end of the screen
      if (pointerXRef.current > w) firstSweepRef.current = false;
    } else {
      // Continuous scrolling mode
      if (pointerXRef.current > w) {
        // Reset pointer when it reaches the end but keep the animation state
        pointerXRef.current = 0;
        
        // Generate new points with current parameters
        // This ensures any parameter changes take effect in the next cycle
        pathPointsRef.current = generateWaveformPoints();
      }
      
      // Create a moving window effect by updating points around the pointer
      const eraseWidth = Math.max(ERASE_WIDTH, w * 0.1); // Use at least 10% of screen width
      const es = pointerXRef.current - eraseWidth / 2;
      const ee = pointerXRef.current + eraseWidth / 2;
      
      // Find indices for the section to update
      const si = Math.max(0, drawnPoints.findIndex(pt => pt && pt.x >= es));
      const ei = drawnPoints.findIndex(pt => pt && pt.x > ee);
      
      // Update points in the visible window
      for (let i = si; i < (ei < 0 ? drawnPoints.length : ei); i++) {
        drawnPoints[i] = pathPoints[i];
      }
      
      // Update the SVG path
      waveformPath.setAttribute("d", pointsToPath(drawnPoints));
    }

    const cur = pathPoints[idx];
    if (cur) {
      pointerHead.setAttribute("cx", cur.x);
      pointerHead.setAttribute("cy", cur.y);
    }
    
    drawnPointsRef.current = drawnPoints;
    animationRef.current = requestAnimationFrame(animationLoop);
  };

  
  const applyNewParams = () => {
    // Store the current pointer position
    const currentPointerX = pointerXRef.current;
    
    // Cancel the current animation frame
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
    
    // Generate new waveform points based on updated parameters
    pathPointsRef.current = generateWaveformPoints();
    
    // Instead of resetting everything, we'll maintain the current state
    // but with the new waveform points
    
    // Keep the current pointer position
    pointerXRef.current = currentPointerX;
    
    // Reset drawn points but maintain the animation state
    drawnPointsRef.current = Array(pathPointsRef.current.length).fill(null);
    
    // Don't reset the first sweep flag - maintain the current animation mode
    // firstSweepRef.current = true;
    
    // Maintain the timestamp to avoid jumps in animation
    // lastTimestampRef.current = 0;
    
    // Restart the animation loop
    animationRef.current = requestAnimationFrame(animationLoop);
  };

  
   
  useEffect(() => {
    
    initializeSVG();
    
    pathPointsRef.current = generateWaveformPoints();
    drawnPointsRef.current = Array(pathPointsRef.current.length).fill(null);
    
    animationRef.current = requestAnimationFrame(animationLoop);
    
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  return (
    <div className="p-6 bg-gradient-to-br from-gray-50 to-blue-50 min-h-screen">
      <h1 className="text-3xl font-bold mb-6 text-center text-indigo-800 flex items-center justify-center gap-3">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-indigo-600" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd" />
        </svg>
        ECG Waveform Animator
      </h1>
      
      <div className="flex gap-8 flex-wrap">
        
        <div className="flex-1 min-w-80 bg-white p-6 rounded-xl shadow-lg overflow-y-auto max-h-[95vh] border border-indigo-100">
          <div className="flex items-center mb-4 gap-3 bg-gradient-to-r from-blue-50 to-indigo-50 p-3 rounded-lg">
            <label htmlFor="heart_rate" className="flex-1 min-w-36 text-sm font-medium text-indigo-700">Heart Rate (bpm):</label>
            <input 
              type="number" 
              id="heart_rate" 
              value={params.heart_rate} 
              onChange={handleInputChange}
              className="flex-1 min-w-16 p-2 border border-indigo-200 rounded-md focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500 outline-none transition-all"
              step="1" 
              min="20" 
              max="250" 
            />
          </div>
          
          <div className="flex items-center mb-4 gap-3 bg-gradient-to-r from-blue-50 to-indigo-50 p-3 rounded-lg">
            <label htmlFor="pixelsPerMv" className="flex-1 min-w-36 text-sm font-medium text-indigo-700">Pixels per mV:</label>
            <input 
              type="number" 
              id="pixelsPerMv" 
              value={params.pixelsPerMv} 
              onChange={handleInputChange}
              className="flex-1 min-w-16 p-2 border border-indigo-200 rounded-md focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500 outline-none transition-all"
              step="10" 
              min="10" 
            />
          </div>

          <h3 className="font-semibold text-lg mt-6 mb-3 text-indigo-800 border-b border-indigo-100 pb-2">Wave Parameters (mV, sec)</h3>
          
          
          {[
            { id: 'h_p', label: 'P Wave Height' },
            { id: 'b_p', label: 'P Wave Breadth' },
            { id: 'h_q', label: 'Q Wave Height' },
            { id: 'b_q', label: 'Q Wave Breadth' },
            { id: 'h_r', label: 'R Wave Height' },
            { id: 'b_r', label: 'R Wave Breadth' },
            { id: 'h_s', label: 'S Wave Height' },
            { id: 'b_s', label: 'S Wave Breadth' },
            { id: 'h_t', label: 'T Wave Height' },
            { id: 'b_t', label: 'T Wave Breadth' },
            { id: 'l_pq', label: 'PQ Segment Length' },
            { id: 'l_st', label: 'ST Segment Length' },
            { id: 'l_tp', label: 'TP Segment Length' },
            { id: 'n_p', label: 'Default P Waves per QRS' }
          ].map(param => (
            <div key={param.id} className="flex items-center mb-3 gap-2.5 hover:bg-gray-50 p-2 rounded-md transition-colors">
              <label htmlFor={param.id} className="flex-1 min-w-36 text-sm font-medium text-gray-700">{param.label}:</label>
              <input 
                type="number" 
                id={param.id} 
                value={params[param.id]} 
                onChange={handleInputChange}
                className="flex-1 min-w-16 p-1.5 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500 outline-none transition-all"
                step={param.id === 'n_p' ? "1" : "0.01"} 
              />
            </div>
          ))}

          <h3 className="font-semibold text-lg mt-6 mb-3 text-indigo-800 border-b border-indigo-100 pb-2">Dynamic R Wave Pattern</h3>
          <div className="flex items-center mb-4 gap-2.5 bg-blue-50 p-3 rounded-lg">
            <label className="flex items-center cursor-pointer">
              <input 
                type="checkbox" 
                id="rWaveEnabled" 
                checked={params.rWaveEnabled} 
                onChange={handleInputChange}
                className="form-checkbox h-5 w-5 text-indigo-600 rounded focus:ring-indigo-400 mr-3 transition duration-150 ease-in-out"
              /> 
              <span className="font-medium text-indigo-700">Enable R Wave Pattern</span>
            </label>
          </div>
          
          <div className="flex items-center mb-3 gap-2.5 pl-3 border-l-2 border-indigo-200">
            <label htmlFor="rWaveCount" className="flex-1 min-w-36 text-sm font-medium text-gray-700">R Waves in Pattern:</label>
            <input 
              type="number" 
              id="rWaveCount" 
              value={params.rWaveCount} 
              onChange={handleInputChange}
              className="flex-1 min-w-16 p-1.5 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500 outline-none transition-all"
              step="1" 
              min="0" 
            />
          </div>
          
          <div className="flex items-center mb-5 gap-2.5 pl-3 border-l-2 border-indigo-200">
            <label htmlFor="rWaveInterval" className="flex-1 min-w-36 text-sm font-medium text-gray-700">Apply After N QRS:</label>
            <input 
              type="number" 
              id="rWaveInterval" 
              value={params.rWaveInterval} 
              onChange={handleInputChange}
              className="flex-1 min-w-16 p-1.5 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500 outline-none transition-all"
              step="1" 
              min="0" 
            />
          </div>

          <h3 className="font-semibold text-lg mt-6 mb-3 text-indigo-800 border-b border-indigo-100 pb-2">Dynamic P Wave Pattern</h3>
          <div className="flex items-center mb-4 gap-2.5 bg-blue-50 p-3 rounded-lg">
            <label className="flex items-center cursor-pointer">
              <input 
                type="checkbox" 
                id="pWaveEnabled" 
                checked={params.pWaveEnabled} 
                onChange={handleInputChange}
                className="form-checkbox h-5 w-5 text-indigo-600 rounded focus:ring-indigo-400 mr-3 transition duration-150 ease-in-out"
              /> 
              <span className="font-medium text-indigo-700">Enable P Wave Pattern</span>
            </label>
          </div>
          
          <div className="flex items-center mb-3 gap-2.5 pl-3 border-l-2 border-indigo-200">
            <label htmlFor="pWaveCount" className="flex-1 min-w-36 text-sm font-medium text-gray-700">P Waves in Pattern:</label>
            <input 
              type="number" 
              id="pWaveCount" 
              value={params.pWaveCount} 
              onChange={handleInputChange}
              className="flex-1 min-w-16 p-1.5 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500 outline-none transition-all"
              step="1" 
              min="0" 
            />
          </div>
          
          <div className="flex items-center mb-5 gap-2.5 pl-3 border-l-2 border-indigo-200">
            <label htmlFor="pWaveInterval" className="flex-1 min-w-36 text-sm font-medium text-gray-700">Apply After N QRS:</label>
            <input 
              type="number" 
              id="pWaveInterval" 
              value={params.pWaveInterval} 
              onChange={handleInputChange}
              className="flex-1 min-w-16 p-1.5 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500 outline-none transition-all"
              step="1" 
              min="0" 
            />
          </div>

          <h3 className="font-semibold text-lg mt-6 mb-3 text-indigo-800 border-b border-indigo-100 pb-2">Custom Beat Sequence</h3>
          <div className="flex items-center mb-4 gap-2.5 bg-blue-50 p-3 rounded-lg">
            <label className="flex items-center cursor-pointer">
              <input 
                type="checkbox" 
                id="useCustomBeatParameters" 
                checked={params.useCustomBeatParameters} 
                onChange={handleInputChange}
                className="form-checkbox h-5 w-5 text-indigo-600 rounded focus:ring-indigo-400 mr-3 transition duration-150 ease-in-out"
              /> 
              <span className="font-medium text-indigo-700">Enable Custom Beat Sequence</span>
            </label>
          </div>
          
          <div className="flex items-center mb-4 gap-2.5 pl-3 border-l-2 border-indigo-200">
            <label htmlFor="repeatInterval" className="flex-1 min-w-36 text-sm font-medium text-gray-700">Normal Beats Before Repeat:</label>
            <input 
              type="number" 
              id="repeatInterval" 
              value={params.repeatInterval} 
              onChange={handleInputChange}
              className="flex-1 min-w-16 p-1.5 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500 outline-none transition-all"
              step="1" 
              min="0" 
            />
          </div>
          
          
          <div className="mt-4">
            {customBeatsParameters.map((beat, index) => (
              <div key={index} className="border border-indigo-100 p-3 mb-4 bg-gradient-to-r from-white to-blue-50 rounded-lg shadow-sm hover:shadow-md transition-shadow">
                {[
                  { id: 'h_p', label: 'P Height' },
                  { id: 'b_p', label: 'P Breadth' },
                  { id: 'h_q', label: 'Q Height' },
                  { id: 'b_q', label: 'Q Breadth' },
                  { id: 'h_r', label: 'R Height' },
                  { id: 'b_r', label: 'R Breadth' },
                  { id: 'h_s', label: 'S Height' },
                  { id: 'b_s', label: 'S Breadth' },
                  { id: 'h_t', label: 'T Height' },
                  { id: 'b_t', label: 'T Breadth' },
                  { id: 'l_pq', label: 'PQ Length' },
                  { id: 'l_st', label: 'ST Length' },
                  { id: 'l_tp', label: 'TP Length' }
                ].map(param => (
                  <div key={param.id} className="flex items-center mb-1.5 gap-2">
                    <label className="flex-1 min-w-24 text-xs font-medium text-gray-600">{param.label}:</label>
                    <input 
                      type="number" 
                      value={beat[param.id]} 
                      onChange={(e) => handleCustomBeatChange(index, param.id, e.target.value)}
                      className="flex-1 min-w-14 p-1 text-sm border border-gray-300 rounded-md focus:ring-1 focus:ring-indigo-300 focus:border-indigo-500 outline-none transition-all"
                      step="0.01" 
                    />
                  </div>
                ))}
                <button 
                  onClick={() => removeCustomBeat(index)}
                  className="mt-2 bg-red-500 hover:bg-red-600 text-white border-none py-1.5 px-3 cursor-pointer rounded-md text-sm flex items-center gap-1.5 transition-colors shadow-sm"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  Remove Beat
                </button>
              </div>
            ))}
          </div>
          
          <button 
            onClick={addCustomBeat} 
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md mb-4 flex items-center gap-2 transition-colors shadow-sm"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
            </svg>
            Add Custom Beat
          </button>

          <div className="mt-6 relative">
            <div className="absolute inset-0 bg-gradient-to-r from-blue-500/20 to-blue-700/20 blur-md"></div>
            <button 
              onClick={applyNewParams}
              className="relative w-full py-4 px-0 text-base font-semibold border-none rounded-md bg-gradient-to-r from-blue-600 to-blue-800 text-white cursor-pointer hover:from-blue-700 hover:to-blue-900 transition-all shadow-lg flex items-center justify-center gap-3"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <path d="M22 4L12 14.01l-3-3" />
              </svg>
              <span className="tracking-wide">Apply Changes to ECG</span>
            </button>
          </div>
        </div>
        
        
        <div className="flex-2 min-w-[600px] flex flex-col gap-3">
          <div className="bg-gradient-to-r from-indigo-50 to-blue-50 p-3 rounded-lg flex items-center gap-2 shadow-sm">
            <div className="h-3 w-3 bg-green-500 rounded-full animate-pulse"></div>
            <span className="text-indigo-700 font-medium">Live ECG Preview</span>
          </div>
          <svg 
            ref={svgRef} 
            id="ecgSVG" 
            width="1000" 
            height="400"
            className="border border-indigo-200 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow p-1"
          />
        </div>
      </div>
    </div>
  );
};

export default ECGWaveformAnimator;

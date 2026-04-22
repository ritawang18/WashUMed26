import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

export default function Visualization() {
    const svgRef = useRef(null);
    const plotRef = useRef(null);
    const overtimeRef = useRef(null);
    const simRef = useRef(null);
    const [selectedNode, setSelectedNode] = useState(null);
    const [allNodes, setAllNodes] = useState([]);
    const [allMetrics, setAllMetrics] = useState([]);
    const [filterMetric, setFilterMetric] = useState('all');
    const [filterMin, setFilterMin] = useState('');
    const [filterMax, setFilterMax] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [bmdPanelSubject, setBmdPanelSubject] = useState(null);
    const [chartType, setChartType] = useState('scatter');
    const [xAxis, setXAxis] = useState('');
    const [yAxis, setYAxis] = useState('');
    const [numVar, setNumVar] = useState('');
    const [denVar, setDenVar] = useState('');
    const [modal, setModal] = useState(null); // { subject, variable }
    const modalPlotRef = useRef(null);
    const [editingCell, setEditingCell] = useState(null); // { recordId, field }
    const [editValue, setEditValue] = useState('');
    const [groupings, setGroupings] = useState({}); // { subject_id: { flag, gender, dob, genotype } }
    const [groupingInput, setGroupingInput] = useState({ flag: 'experiment', gender: '', dob: '', genotype: '' });
    const [groupingSaveStatus, setGroupingSaveStatus] = useState(null); // 'saving' | 'saved' | 'error'

    // Fetch data
    useEffect(() => {
        fetch('/api/subject-groupings')
            .then(r => r.json())
            .then(data => {
                if (Array.isArray(data)) {
                    const map = {};
                    data.forEach(({ subject_id, flag, gender, dob, genotype }) => {
                        map[subject_id] = { flag: flag || '', gender: gender || '', dob: dob || '', genotype: genotype || '' };
                    });
                    setGroupings(map);
                }
            })
            .catch(() => {});

        fetch('/api/dexa-records')
            .then(r => r.json())
            .then(data => {
                if (!Array.isArray(data) || data.length === 0) throw new Error('No records found in database.');
                data.forEach((d, i) => {
                    Object.keys(d).forEach(k => {
                        const val = parseFloat(d[k]);
                        if (!isNaN(val) && d[k] !== '') d[k] = val;
                    });
                    d._nodeId = `${d.subject_id}_${d.timepoint}_${i}`;
                });
                const numericCols = new Set();
                data.forEach(d => Object.keys(d).forEach(k => {
                    if (typeof d[k] === 'number') numericCols.add(k);
                }));
                const metrics = Array.from(numericCols).filter(k => k !== '_nodeId');
                setAllMetrics(metrics);
                setAllNodes(data);
                setXAxis(metrics[0] || '');
                setYAxis(metrics[1] || metrics[0] || '');
                setNumVar(metrics[0] || '');
                setDenVar(metrics[1] || metrics[0] || '');
                setLoading(false);
            })
            .catch(err => {
                setError(err.message);
                setLoading(false);
            });
        return () => { if (simRef.current) simRef.current.stop(); };
    }, []);

    useEffect(() => {
        if (chartType === 'force' && allNodes.length > 0 && svgRef.current) {
            drawGraph(allNodes, []);
        }
    }, [allNodes, chartType]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (chartType !== 'scatter' || !plotRef.current || !allNodes.length || !xAxis || !yAxis) return;
        const Plotly = window.Plotly;
        if (!Plotly) return;

        const sortedTimepoints = Array.from(new Set(allNodes.map(d => d.timepoint)))
            .sort((a, b) => timepointToWeek(a) - timepointToWeek(b));

        const genderSize = (subjectId) => {
            const g = (groupings[subjectId]?.gender || '').trim().toUpperCase();
            if (g === 'M' || g === 'MALE') return 14;
            if (g === 'F' || g === 'FEMALE') return 8;
            return 10;
        };

        const subjectTraces = sortedTimepoints.map(tp => {
            const pts = allNodes.filter(d => d.timepoint === tp);
            return {
                x: pts.map(d => d[xAxis]),
                y: pts.map(d => d[yAxis]),
                text: pts.map(d => d.subject_id),
                customdata: pts,
                mode: 'markers',
                type: 'scatter',
                name: String(tp),
                legendgroup: 'timepoints',
                marker: { size: pts.map(d => genderSize(d.subject_id)), opacity: 0.85 },
                hovertemplate: `<b>%{text}</b><br>${xAxis}: %{x}<br>${yAxis}: %{y}<extra>%{fullData.name}</extra>`,
            };
        });

        const genderLegend = [
            { name: 'M (Male)', size: 14 },
            { name: 'F (Female)', size: 8 },
        ].map(({ name, size }) => ({
            x: [null], y: [null],
            mode: 'markers',
            type: 'scatter',
            name,
            legendgroup: 'gender',
            legendgrouptitle: { text: 'Gender' },
            marker: { size, color: '#555', opacity: 0.85 },
            hoverinfo: 'none',
            showlegend: true,
        }));

        const layout = {
            autosize: true,
            xaxis: { title: { text: xAxis }, gridcolor: '#c0d8e8' },
            yaxis: { title: { text: yAxis }, gridcolor: '#c0d8e8' },
            legend: { title: { text: 'Timepoint' }, bgcolor: 'rgba(197,220,232,0.8)', bordercolor: '#aaa', borderwidth: 1, tracegroupgap: 12 },
            paper_bgcolor: '#b8d4e3',
            plot_bgcolor: '#d0e8f2',
            margin: { l: 70, r: 20, t: 20, b: 70 },
            font: { family: 'sans-serif', color: '#1a2a3a' },
        };

        Plotly.newPlot(plotRef.current, [...subjectTraces, ...genderLegend], layout, { responsive: true }).then(() => {
            plotRef.current.on('plotly_click', (data) => {
                if (data.points && data.points[0]) {
                    setSelectedNode(data.points[0].customdata);
                }
            });
        });
    }, [allNodes, chartType, xAxis, yAxis, groupings]);

    useEffect(() => {
        if (chartType !== 'overtime' || !overtimeRef.current || !allNodes.length || !numVar || !denVar) return;
        const Plotly = window.Plotly;
        if (!Plotly) return;

        const sortedTimepoints = Array.from(new Set(allNodes.map(d => d.timepoint)))
            .sort((a, b) => timepointToWeek(a) - timepointToWeek(b));

        const subjects = Array.from(new Set(allNodes.map(d => d.subject_id))).sort();

        const SYMBOL = { experiment: 'x', control: 'star', '': 'circle', undefined: 'circle' };

        const otGenderSize = (subjectId) => {
            const g = (groupings[subjectId]?.gender || '').trim().toUpperCase();
            if (g === 'M' || g === 'MALE') return 14;
            if (g === 'F' || g === 'FEMALE') return 8;
            return 9;
        };

        const subjectTraces = subjects.map(subj => {
            const rows = allNodes
                .filter(d => d.subject_id === subj)
                .sort((a, b) => timepointToWeek(a.timepoint) - timepointToWeek(b.timepoint));

            const x = [], y = [], text = [], customdata = [];
            rows.forEach(d => {
                const num = d[numVar], den = d[denVar];
                if (typeof num === 'number' && typeof den === 'number' && den !== 0) {
                    x.push(String(d.timepoint));
                    y.push(num / den);
                    text.push(`Subject: ${subj}<br>Timepoint: ${d.timepoint}<br>${numVar}: ${num.toFixed(4)}<br>${denVar}: ${den.toFixed(4)}<br>Ratio: ${(num/den).toFixed(4)}`);
                    customdata.push(d);
                }
            });

            const g = groupings[subj]?.flag || '';
            return {
                x, y, text, customdata,
                mode: 'lines+markers',
                type: 'scatter',
                name: subj,
                legendgroup: 'subjects',
                hovertemplate: '%{text}<extra></extra>',
                marker: { size: otGenderSize(subj), symbol: SYMBOL[g] || 'circle' },
                line: { width: 2 },
            };
        }).filter(t => t.x.length > 0);

        // Dummy traces for grouping legend
        const groupingLegend = [
            { name: 'Experiment', symbol: 'x', color: '#444' },
            { name: 'Control', symbol: 'star', color: '#444' },
        ].map(({ name, symbol, color }) => ({
            x: [null], y: [null],
            mode: 'markers',
            type: 'scatter',
            name,
            legendgroup: 'grouping',
            legendgrouptitle: { text: 'Grouping' },
            marker: { symbol, size: 10, color },
            hoverinfo: 'none',
            showlegend: true,
        }));

        const otGenderLegend = [
            { name: 'M (Male)', size: 14 },
            { name: 'F (Female)', size: 8 },
        ].map(({ name, size }) => ({
            x: [null], y: [null],
            mode: 'markers',
            type: 'scatter',
            name,
            legendgroup: 'gender',
            legendgrouptitle: { text: 'Gender' },
            marker: { size, color: '#555', opacity: 0.85 },
            hoverinfo: 'none',
            showlegend: true,
        }));

        const traces = [...subjectTraces, ...groupingLegend, ...otGenderLegend];

        const layout = {
            autosize: true,
            xaxis: {
                title: { text: 'Timepoint' },
                categoryorder: 'array',
                categoryarray: sortedTimepoints.map(String),
                gridcolor: '#c0d8e8',
            },
            yaxis: { title: { text: `${numVar} / ${denVar}` }, gridcolor: '#c0d8e8' },
            legend: { bgcolor: 'rgba(197,220,232,0.8)', bordercolor: '#aaa', borderwidth: 1, tracegroupgap: 12 },
            paper_bgcolor: '#b8d4e3',
            plot_bgcolor: '#d0e8f2',
            margin: { l: 70, r: 20, t: 20, b: 70 },
            font: { family: 'sans-serif', color: '#1a2a3a' },
        };

        Plotly.newPlot(overtimeRef.current, traces, layout, { responsive: true }).then(() => {
            overtimeRef.current.on('plotly_click', (data) => {
                if (data.points && data.points[0]) {
                    setSelectedNode(data.points[0].customdata);
                }
            });
        });
    }, [allNodes, chartType, numVar, denVar, groupings]); // eslint-disable-line react-hooks/exhaustive-deps


    useEffect(() => {
        if (!modal || !modalPlotRef.current) return;
        const Plotly = window.Plotly;
        if (!Plotly) return;

        const rows = allNodes
            .filter(d => d.subject_id === modal.subject && typeof d[modal.variable] === 'number')
            .sort((a, b) => timepointToWeek(a.timepoint) - timepointToWeek(b.timepoint));

        const sortedTimepoints = Array.from(new Set(allNodes.map(d => d.timepoint)))
            .sort((a, b) => timepointToWeek(a) - timepointToWeek(b));

        const trace = {
            x: rows.map(d => String(d.timepoint)),
            y: rows.map(d => d[modal.variable]),
            text: rows.map(d => `Timepoint: ${d.timepoint}<br>${modal.variable}: ${d[modal.variable].toFixed(4)}`),
            mode: rows.length > 1 ? 'lines+markers' : 'markers',
            type: 'scatter',
            name: modal.subject,
            hovertemplate: '%{text}<extra></extra>',
            marker: { size: 10, color: '#667eea' },
            line: { color: '#667eea', width: 2 },
        };

        Plotly.newPlot(modalPlotRef.current, [trace], {
            autosize: true,
            title: { text: `${modal.variable} — ${modal.subject}`, font: { size: 14, color: '#1a2a3a' } },
            xaxis: {
                title: { text: 'Timepoint' },
                categoryorder: 'array',
                categoryarray: sortedTimepoints.map(String),
                gridcolor: '#c0d8e8',
            },
            yaxis: { title: { text: modal.variable }, gridcolor: '#c0d8e8' },
            paper_bgcolor: '#eaf4fb',
            plot_bgcolor: '#f4faff',
            margin: { l: 60, r: 20, t: 50, b: 60 },
            font: { family: 'sans-serif', color: '#1a2a3a' },
        }, { responsive: true });
    }, [modal, allNodes]); // eslint-disable-line react-hooks/exhaustive-deps

    // Parse timepoint string to week number for sorting (e.g. "Week_4" → 4, "4w" → 4)
    function timepointToWeek(tp) {
        if (!tp) return 999;
        const s = String(tp).toLowerCase();
        const m = s.match(/(\d+)/);
        return m ? parseInt(m[1]) : 999;
    }

    // Node radius based on gender
    function nodeRadius(d) {
        const g = String(d.gender || '').toLowerCase();
        if (g === 'male' || g === 'm') return 24;
        if (g === 'female' || g === 'f') return 14;
        return 18;
    }

    function getForceSettings(n) {
        if (n < 20)  return { charge: -250, distance: 180, collide: 55 };
        if (n < 50)  return { charge: -200, distance: 140, collide: 45 };
        if (n < 100) return { charge: -160, distance: 120, collide: 38 };
        if (n < 200) return { charge: -120, distance: 100, collide: 32 };
        return { charge: -90, distance: 85, collide: 28 };
    }

    function drawGraph(nodes, links, metric = null) {
        const svg = d3.select(svgRef.current);
        svg.selectAll('*').remove();

        const width = svgRef.current.clientWidth;
        const height = svgRef.current.clientHeight;
        const s = getForceSettings(nodes.length);

        // Sort timepoints by week number, assign teal color scale (darker=older, lighter=newer)
        const sortedTimepoints = Array.from(new Set(nodes.map(d => d.timepoint)))
            .sort((a, b) => timepointToWeek(a) - timepointToWeek(b));
        const tealScale = d3.scaleSequential(d3.interpolate('#1a5276', '#a8d8ea'))
            .domain([0, sortedTimepoints.length - 1]);
        const timepointColor = Object.fromEntries(
            sortedTimepoints.map((tp, i) => [tp, tealScale(i)])
        );

        const linkForce = d3.forceLink()
            .id(d => d._nodeId)
            .distance(s.distance)
            .strength(d => d.strength || 0.6);
        if (links.length) linkForce.links(links);

        const sim = d3.forceSimulation(nodes)
            .force('link', linkForce)
            .force('charge', d3.forceManyBody().strength(s.charge))
            .force('center', d3.forceCenter(width / 2, height / 2))
            .force('collision', d3.forceCollide().radius(d => nodeRadius(d) + 4))
            .force('x', d3.forceX(width / 2).strength(0.1))
            .force('y', d3.forceY(height / 2).strength(0.1));
        simRef.current = sim;

        const linkG = svg.append('g').attr('class', 'links');
        const nodeG = svg.append('g').attr('class', 'nodes');
        const labelG = svg.append('g').attr('class', 'labels');

        const line = linkG.selectAll('line').data(links)
            .join('line')
            .attr('stroke', d => d.color || '#aaa')
            .attr('stroke-width', metric ? 2 : 0.8)
            .attr('opacity', metric ? 0.8 : 0.3);

        const circle = nodeG.selectAll('circle').data(nodes, d => d._nodeId)
            .join('circle')
            .attr('r', d => nodeRadius(d))
            .attr('fill', d => {
                if (metric) {
                    const val = d[metric];
                    if (val == null) return '#ccc';
                    const range = d3.extent(nodes, n => n[metric]);
                    return d3.scaleSequential(d3.interpolateViridis).domain(range.reverse())(val);
                }
                return timepointColor[d.timepoint] || '#888';
            })
            .attr('stroke', '#222')
            .attr('stroke-width', 1.8)
            .style('cursor', 'pointer')
            .on('click', (event, d) => setSelectedNode(d))
            .call(d3.drag()
                .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
                .on('drag',  (e, d) => { d.fx = e.x; d.fy = e.y; })
                .on('end',   (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; })
            );

        labelG.selectAll('text').data(nodes, d => d._nodeId)
            .join('text')
            .attr('text-anchor', 'middle')
            .attr('dy', 4)
            .text(d => d.subject_id)
            .style('fill', '#fff')
            .style('font-size', '10px')
            .style('font-weight', '600')
            .style('pointer-events', 'none');

        // Legend for timepoints
        const legend = svg.append('g').attr('transform', 'translate(16, 16)');
        sortedTimepoints.forEach((tp, i) => {
            legend.append('rect').attr('x', 0).attr('y', i * 20).attr('width', 14).attr('height', 14)
                .attr('fill', tealScale(i)).attr('rx', 3);
            legend.append('text').attr('x', 20).attr('y', i * 20 + 11)
                .text(tp).style('fill', '#1a2a3a').style('font-size', '11px');
        });

        // Legend for gender size
        const gLegend = svg.append('g').attr('transform', `translate(16, ${sortedTimepoints.length * 20 + 32})`);
        [['M (Male)', 24], ['Unknown', 18], ['F (Female)', 14]].forEach(([label, r], i) => {
            gLegend.append('circle').attr('cx', 7).attr('cy', i * 28 + 7).attr('r', r * 0.55)
                .attr('fill', '#667eea').attr('stroke', '#222').attr('stroke-width', 1);
            gLegend.append('text').attr('x', 20).attr('y', i * 28 + 11)
                .text(label).style('fill', '#1a2a3a').style('font-size', '11px');
        });

        sim.on('tick', () => {
            if (links.length) {
                line.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
                    .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
            }
            circle.attr('cx', d => d.x).attr('cy', d => d.y);
            labelG.selectAll('text').attr('x', d => d.x).attr('y', d => d.y);
        });
    }

    function applyFilter() {
        if (filterMetric === 'all' || (filterMin === '' && filterMax === '')) {
            drawGraph(allNodes, []);
            return;
        }
        const min = parseFloat(filterMin);
        const max = parseFloat(filterMax);
        const filtered = allNodes.filter(d => {
            const val = d[filterMetric];
            if (typeof val !== 'number') return false;
            if (!isNaN(min) && val < min) return false;
            if (!isNaN(max) && val > max) return false;
            return true;
        });
        const range = d3.max(filtered, d => d[filterMetric]) - d3.min(filtered, d => d[filterMetric]);
        const colorLink = d3.scaleSequential(d3.interpolateRdYlBu).domain([0, range]);
        const links = [];
        for (let i = 0; i < filtered.length; i++) {
            for (let j = i + 1; j < filtered.length; j++) {
                const a = filtered[i][filterMetric], b = filtered[j][filterMetric];
                if (a != null && b != null) {
                    const diff = Math.abs(a - b);
                    links.push({ source: filtered[i]._nodeId, target: filtered[j]._nodeId, diff, color: colorLink(diff), strength: 1 - (diff / (range || 1)) });
                }
            }
        }
        drawGraph(filtered, links, filterMetric);
    }

    function resetFilter() {
        setFilterMetric('all');
        setFilterMin('');
        setFilterMax('');
        setSelectedNode(null);
        drawGraph(allNodes, []);
    }

    // Pre-populate grouping form from saved data when panel opens
    useEffect(() => {
        if (!selectedNode) return;
        const g = groupings[selectedNode.subject_id];
        if (g) setGroupingInput({ flag: g.flag || 'experiment', gender: g.gender || '', dob: g.dob || '', genotype: g.genotype || '' });
        else setGroupingInput({ flag: 'experiment', gender: '', dob: '', genotype: '' });
    }, [selectedNode]); // eslint-disable-line react-hooks/exhaustive-deps

    async function saveEdit(recordId, field, originalValue) {
        const isNum = typeof originalValue === 'number';
        const parsed = isNum ? parseFloat(editValue) : editValue;
        if (isNum && isNaN(parsed)) { setEditingCell(null); return; }
        try {
            await fetch(`/api/dexa-records/${recordId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ [field]: parsed }),
            });
            setAllNodes(prev => prev.map(n => n.id === recordId ? { ...n, [field]: parsed } : n));
            setSelectedNode(prev => ({ ...prev, [field]: parsed }));
        } catch (e) { console.error(e); }
        setEditingCell(null);
    }

    if (loading) return <div style={{ color: '#eee', padding: 40, background: '#b8d4e3', height: '100vh' }}>Loading records...</div>;
    if (error) return <div style={{ color: '#f88', padding: 40, background: '#b8d4e3', height: '100vh' }}>Error: {error}</div>;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#b8d4e3', color: '#1a2a3a', fontFamily: 'sans-serif' }}>
            {/* Top bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', background: '#c5dce8', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: '1rem' }}>DEXA Visualization</strong>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <label style={{ fontSize: '0.85rem' }}>Chart:</label>
                    <select value={chartType} onChange={e => { setChartType(e.target.value); setSelectedNode(null); }} style={inputStyle}>
                        <option value="scatter">Scatter Plot</option>
                        <option value="overtime">Over Time Plot</option>
                        <option value="force">Force Graph</option>
                    </select>
                </div>

                {chartType === 'scatter' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <label style={{ fontSize: '0.85rem' }}>X:</label>
                        <select value={xAxis} onChange={e => setXAxis(e.target.value)} style={inputStyle}>
                            {allMetrics.map(f => <option key={f} value={f}>{f}</option>)}
                        </select>
                        <label style={{ fontSize: '0.85rem' }}>Y:</label>
                        <select value={yAxis} onChange={e => setYAxis(e.target.value)} style={inputStyle}>
                            {allMetrics.map(f => <option key={f} value={f}>{f}</option>)}
                        </select>
                    </div>
                )}

                {chartType === 'overtime' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <label style={{ fontSize: '0.85rem' }}>Numerator:</label>
                        <select value={numVar} onChange={e => setNumVar(e.target.value)} style={inputStyle}>
                            {allMetrics.map(f => <option key={f} value={f}>{f}</option>)}
                        </select>
                        <label style={{ fontSize: '0.85rem' }}>÷ Denominator:</label>
                        <select value={denVar} onChange={e => setDenVar(e.target.value)} style={inputStyle}>
                            {allMetrics.map(f => <option key={f} value={f}>{f}</option>)}
                        </select>
                    </div>
                )}

                {chartType === 'force' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
                        <label style={{ fontSize: '0.85rem' }}>Filter by:</label>
                        <select value={filterMetric} onChange={e => setFilterMetric(e.target.value)} style={inputStyle}>
                            <option value="all">All</option>
                            {allMetrics.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                        <input type="number" placeholder="Min" value={filterMin} onChange={e => setFilterMin(e.target.value)} style={{ ...inputStyle, width: 70 }} />
                        <input type="number" placeholder="Max" value={filterMax} onChange={e => setFilterMax(e.target.value)} style={{ ...inputStyle, width: 70 }} />
                        <button onClick={applyFilter} style={btnStyle('#667eea')}>Apply</button>
                        <button onClick={resetFilter} style={btnStyle('#444')}>Reset</button>
                    </div>
                )}
            </div>

            {/* Main area */}
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
                {/* BMD over-time panel (left, force graph only) */}
                {chartType === 'force' && bmdPanelSubject && (() => {
                    const subjectRows = allNodes
                        .filter(n => n.subject_id === bmdPanelSubject)
                        .sort((a, b) => timepointToWeek(a.timepoint) - timepointToWeek(b.timepoint));
                    const bmdCols = subjectRows.length > 0
                        ? Object.keys(subjectRows[0]).filter(k => k.toLowerCase().includes('bmd') && !['_nodeId'].includes(k))
                        : [];
                    return (
                        <div style={{ width: 360, background: '#d0e8f2', borderRight: '2px solid #00b4d8', overflowY: 'auto', padding: 16, flexShrink: 0 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                                <strong style={{ color: '#00b4d8' }}>BMD over time — {bmdPanelSubject}</strong>
                            </div>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                                <thead>
                                    <tr>
                                        <th style={thStyle}>Timepoint</th>
                                        {bmdCols.map(c => <th key={c} style={thStyle}>{c}</th>)}
                                    </tr>
                                </thead>
                                <tbody>
                                    {subjectRows.map((row, i) => (
                                        <tr key={i} style={{ borderBottom: '1px solid #ccc' }}>
                                            <td style={{ ...tdStyle, color: '#000' }}>{row.timepoint ?? '—'}</td>
                                            {bmdCols.map(c => (
                                                <td key={c} style={{ ...tdStyle, color: '#000' }}>
                                                    {typeof row[c] === 'number' ? row[c].toFixed(4) : (row[c] ?? '—')}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    );
                })()}
                <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                    {chartType === 'scatter' && (
                        <div ref={plotRef} style={{ width: '100%', height: '100%' }} />
                    )}
                    {chartType === 'overtime' && (
                        <div ref={overtimeRef} style={{ width: '100%', height: '100%' }} />
                    )}
                    {chartType === 'force' && (
                        <svg ref={svgRef} style={{ width: '100%', height: '100%', display: 'block' }} />
                    )}
                </div>

                {/* Side panel — absolutely positioned so it overlays the chart without resizing it */}
                {selectedNode && (
                    <div style={{ position: 'absolute', top: 0, right: 0, width: 340, height: '100%', background: '#c5dce8', borderLeft: '2px solid #667eea', overflowY: 'auto', padding: 16, zIndex: 10, boxShadow: '-4px 0 16px rgba(0,0,0,0.12)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                            <strong style={{ color: '#667eea' }}>Subject: {selectedNode.subject_id}</strong>
                            <span onClick={() => { setSelectedNode(null); setBmdPanelSubject(null); }} style={{ cursor: 'pointer', fontSize: '1.2rem', color: '#aaa' }}>×</span>
                        </div>
                        <div style={{ fontSize: '0.72rem', color: '#555', marginBottom: 8 }}>Click a numeric value to plot over time</div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                            <tbody>
                                {(() => {
                                    const NON_CHART_CLICKABLE = new Set(['subject_id']);
                                    const NON_EDITABLE = new Set(['id', 'session_id', 'user_id']);
                                    const HIDDEN = new Set(['_nodeId', 'x', 'y', 'vx', 'vy', 'fx', 'fy', 'index', 'filename', 'id', 'user_id', 'session_id', 'gender']);
                                    const ORDER = ['batch', 'subject_id', 'gender', 'timepoint'];
                                    const entries = Object.entries(selectedNode).filter(([k]) => !HIDDEN.has(k));
                                    const ordered = [
                                        ...ORDER.map(k => entries.find(([ek]) => ek === k)).filter(Boolean),
                                        ...entries.filter(([k]) => !ORDER.includes(k)),
                                    ];
                                    const recordId = selectedNode.id;
                                    return ordered.map(([k, v]) => {
                                        const isNumeric = typeof v === 'number' && !NON_CHART_CLICKABLE.has(k);
                                        const isEditable = !NON_EDITABLE.has(k);
                                        const isEditing = editingCell?.recordId === recordId && editingCell?.field === k;
                                        const isBmd = k === 'roi_bmd';
                                        const isActive = isBmd && bmdPanelSubject === selectedNode.subject_id;
                                        return (
                                            <tr key={k} style={{ borderBottom: '1px solid #ccc' }}>
                                                <td
                                                    style={{ color: isNumeric ? '#3a5fc8' : '#000', padding: '4px 6px', width: '45%', wordBreak: 'break-all', cursor: isNumeric ? 'pointer' : 'default', textDecoration: isNumeric ? 'underline dotted' : 'none' }}
                                                    onClick={() => {
                                                        if (isNumeric) setModal({ subject: selectedNode.subject_id, variable: k });
                                                        else if (isBmd) setBmdPanelSubject(isActive ? null : selectedNode.subject_id);
                                                    }}
                                                >
                                                    {k}{isBmd && !isNumeric ? ' ↔' : ''}
                                                </td>
                                                <td style={{ padding: '2px 4px', color: '#000' }}>
                                                    {isEditing ? (
                                                        <input
                                                            autoFocus
                                                            value={editValue}
                                                            onChange={e => setEditValue(e.target.value)}
                                                            onKeyDown={e => {
                                                                if (e.key === 'Enter') saveEdit(recordId, k, v);
                                                                if (e.key === 'Escape') setEditingCell(null);
                                                            }}
                                                            onBlur={() => saveEdit(recordId, k, v)}
                                                            style={{ width: '100%', padding: '2px 4px', fontSize: '0.82rem', border: '1px solid #667eea', borderRadius: 3, background: '#fff' }}
                                                        />
                                                    ) : (
                                                        <span
                                                            onClick={() => {
                                                                if (!isEditable) return;
                                                                setEditingCell({ recordId, field: k });
                                                                setEditValue(typeof v === 'number' ? String(v) : String(v ?? ''));
                                                            }}
                                                            style={{ display: 'block', cursor: isEditable ? 'text' : 'default', padding: '2px 4px', borderRadius: 3, minHeight: 20, background: isEditable ? 'rgba(255,255,255,0.4)' : 'transparent' }}
                                                            title={isEditable ? 'Click to edit' : ''}
                                                        >
                                                            {typeof v === 'number' ? v.toFixed(4) : String(v ?? '')}
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    });
                                })()}
                            </tbody>
                        </table>

                        {/* Grouping section */}
                        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #aac' }}>
                            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#3a3a6a', marginBottom: 8 }}>Grouping</div>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                                <tbody>
                                    <tr style={{ borderBottom: '1px solid #ccc' }}>
                                        <td style={{ padding: '4px 6px', color: '#000', width: '45%' }}>Flag</td>
                                        <td style={{ padding: '2px 4px' }}>
                                            <select value={groupingInput.flag} onChange={e => setGroupingInput(p => ({ ...p, flag: e.target.value }))} style={{ ...inputStyle, fontSize: '0.82rem', width: '100%' }}>
                                                <option value="experiment">Experiment</option>
                                                <option value="control">Control</option>
                                            </select>
                                        </td>
                                    </tr>
                                    <tr style={{ borderBottom: '1px solid #ccc' }}>
                                        <td style={{ padding: '4px 6px', color: '#000' }}>Gender</td>
                                        <td style={{ padding: '2px 4px' }}>
                                            <input value={groupingInput.gender} onChange={e => setGroupingInput(p => ({ ...p, gender: e.target.value }))} style={{ ...inputStyle, fontSize: '0.82rem', width: '100%' }} placeholder="e.g. M / F" />
                                        </td>
                                    </tr>
                                    <tr style={{ borderBottom: '1px solid #ccc' }}>
                                        <td style={{ padding: '4px 6px', color: '#000' }}>Date of Birth</td>
                                        <td style={{ padding: '2px 4px' }}>
                                            <input value={groupingInput.dob} onChange={e => setGroupingInput(p => ({ ...p, dob: e.target.value }))} style={{ ...inputStyle, fontSize: '0.82rem', width: '100%' }} placeholder="e.g. 2020-01-15" />
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style={{ padding: '4px 6px', color: '#000' }}>Genotype</td>
                                        <td style={{ padding: '2px 4px' }}>
                                            <input value={groupingInput.genotype} onChange={e => setGroupingInput(p => ({ ...p, genotype: e.target.value }))} style={{ ...inputStyle, fontSize: '0.82rem', width: '100%' }} placeholder="e.g. WT / KO" />
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                            <button
                                style={{ ...btnStyle(groupingSaveStatus === 'error' ? '#c0392b' : groupingSaveStatus === 'saved' ? '#27ae60' : '#667eea'), marginTop: 10, width: '100%' }}
                                onClick={async () => {
                                    const subj = selectedNode.subject_id;
                                    setGroupingSaveStatus('saving');
                                    try {
                                        const res = await fetch(`/api/subject-groupings/${encodeURIComponent(subj)}`, {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify(groupingInput),
                                        });
                                        const json = await res.json();
                                        if (!res.ok || json.error) {
                                            console.error('Grouping save error:', json.error);
                                            setGroupingSaveStatus('error');
                                        } else {
                                            setGroupings(prev => ({ ...prev, [subj]: { ...groupingInput } }));
                                            setGroupingSaveStatus('saved');
                                        }
                                    } catch (e) {
                                        console.error('Grouping save failed:', e);
                                        setGroupingSaveStatus('error');
                                    }
                                    setTimeout(() => setGroupingSaveStatus(null), 2500);
                                }}
                            >
                                {groupingSaveStatus === 'saving' ? 'Saving…' : groupingSaveStatus === 'saved' ? 'Saved ✓' : groupingSaveStatus === 'error' ? 'Error — see console' : 'Save Grouping'}
                            </button>
                        </div>
                    </div>
                )}

                {/* Over-time modal */}
                {modal && (
                    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        onClick={() => setModal(null)}>
                        <div style={{ background: '#eaf4fb', borderRadius: 10, padding: 20, width: 640, maxWidth: '90vw', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}
                            onClick={e => e.stopPropagation()}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                                <strong style={{ color: '#1a2a3a' }}>{modal.variable} over time — {modal.subject}</strong>
                                <span onClick={() => setModal(null)} style={{ cursor: 'pointer', fontSize: '1.4rem', color: '#aaa', lineHeight: 1 }}>×</span>
                            </div>
                            <div ref={modalPlotRef} style={{ width: '100%', height: 340 }} />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

const btnStyle = (bg) => ({
    padding: '4px 12px', borderRadius: 4, border: 'none',
    background: bg, color: '#fff', cursor: 'pointer', fontSize: '0.85rem'
});

const inputStyle = {
    padding: '4px 8px', borderRadius: 4, border: '1px solid #555',
    background: '#fff', color: '#1a2a3a', fontSize: '0.85rem'
};

const thStyle = {
    padding: '4px 6px', textAlign: 'left', color: '#000',
    borderBottom: '1px solid #ccc', whiteSpace: 'nowrap'
};

const tdStyle = {
    padding: '4px 6px', color: '#000', whiteSpace: 'nowrap'
};

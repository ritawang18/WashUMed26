import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

export default function Visualization() {
    const svgRef = useRef(null);
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

    // Fetch data
    useEffect(() => {
        fetch('/api/dexa-records')
            .then(r => r.json())
            .then(data => {
                if (!data || data.length === 0) throw new Error('No records found in database.');
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
                setAllMetrics(Array.from(numericCols).filter(k => k !== '_nodeId'));
                setAllNodes(data);
                setLoading(false);
            })
            .catch(err => {
                setError(err.message);
                setLoading(false);
            });
        return () => { if (simRef.current) simRef.current.stop(); };
    }, []);

    // Draw when data is ready and SVG is mounted
    useEffect(() => {
        if (allNodes.length > 0 && svgRef.current) {
            drawGraph(allNodes, []);
        }
    }, [allNodes]);

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

    if (loading) return <div style={{ color: '#eee', padding: 40, background: '#b8d4e3', height: '100vh' }}>Loading records...</div>;
    if (error) return <div style={{ color: '#f88', padding: 40, background: '#b8d4e3', height: '100vh' }}>Error: {error}</div>;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#b8d4e3', color: '#1a2a3a', fontFamily: 'sans-serif' }}>
            {/* Top bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', background: '#c5dce8', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: '1rem' }}>DEXA Visualization</strong>

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
            </div>

            {/* Main area */}
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                {/* BMD over-time panel (left) */}
                {bmdPanelSubject && (() => {
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
                <svg ref={svgRef} style={{ flex: 1, display: 'block' }} />

                {/* Side panel */}
                {selectedNode && (
                    <div style={{ width: 340, background: '#c5dce8', borderLeft: '2px solid #667eea', overflowY: 'auto', padding: 16 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <strong style={{ color: '#667eea' }}>Subject: {selectedNode.subject_id}</strong>
                            <span onClick={() => { setSelectedNode(null); setBmdPanelSubject(null); }} style={{ cursor: 'pointer', fontSize: '1.2rem', color: '#aaa' }}>×</span>
                        </div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                            <tbody>
                                {Object.entries(selectedNode)
                                    .filter(([k]) => !['_nodeId', 'x', 'y', 'vx', 'vy', 'fx', 'fy', 'index'].includes(k))
                                    .map(([k, v]) => {
                                        const isBmd = k === 'roi_bmd';
                                        const isActive = isBmd && bmdPanelSubject === selectedNode.subject_id;
                                        return (
                                            <tr
                                                key={k}
                                                style={{ borderBottom: '1px solid #ccc', background: 'transparent' }}
                                                onClick={isBmd ? () => setBmdPanelSubject(isActive ? null : selectedNode.subject_id) : undefined}
                                            >
                                                <td style={{ color: '#000', padding: '4px 6px', width: '55%', wordBreak: 'break-all', cursor: isBmd ? 'pointer' : 'default' }}>{k}{isBmd ? ' ↔' : ''}</td>
                                                <td style={{ padding: '4px 6px', color: '#000', cursor: isBmd ? 'pointer' : 'default' }}>{typeof v === 'number' ? v.toFixed(4) : String(v)}</td>
                                            </tr>
                                        );
                                    })}
                            </tbody>
                        </table>
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

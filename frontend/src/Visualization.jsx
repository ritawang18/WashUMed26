import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

export default function Visualization({ csvFilename, onBack }) {
    const svgRef = useRef(null);
    const simRef = useRef(null);
    const [selectedNode, setSelectedNode] = useState(null);
    const [allNodes, setAllNodes] = useState([]);
    const [allMetrics, setAllMetrics] = useState([]);
    const [filterMetric, setFilterMetric] = useState('all');
    const [filterMin, setFilterMin] = useState('');
    const [filterMax, setFilterMax] = useState('');

    useEffect(() => {
        if (!csvFilename) return;

        d3.csv(`/api/download/${csvFilename}`).then(raw => {
            // Parse numeric fields
            raw.forEach((d, i) => {
                Object.keys(d).forEach(k => {
                    const val = parseFloat(d[k]);
                    if (!isNaN(val) && d[k] !== '') d[k] = val;
                });
                d._nodeId = `${d.subject_id}_${d.timepoint}_${i}`;
            });

            // Collect numeric columns for filter dropdown
            const numericCols = new Set();
            raw.forEach(d => Object.keys(d).forEach(k => {
                if (typeof d[k] === 'number') numericCols.add(k);
            }));
            setAllMetrics(Array.from(numericCols).filter(k => k !== '_nodeId'));
            setAllNodes(raw);
            drawGraph(raw, []);
        }).catch(err => console.error('Failed to load CSV:', err));

        return () => { if (simRef.current) simRef.current.stop(); };
    }, [csvFilename]);

    function getForceSettings(n) {
        if (n < 20)  return { charge: -250, distance: 180, collide: 50 };
        if (n < 50)  return { charge: -200, distance: 140, collide: 40 };
        if (n < 100) return { charge: -160, distance: 120, collide: 35 };
        if (n < 200) return { charge: -120, distance: 100, collide: 30 };
        return { charge: -90, distance: 85, collide: 25 };
    }

    function drawGraph(nodes, links, metric = null) {
        const svg = d3.select(svgRef.current);
        svg.selectAll('*').remove();

        const width = svgRef.current.clientWidth;
        const height = svgRef.current.clientHeight;
        const s = getForceSettings(nodes.length);

        const timepoints = Array.from(new Set(nodes.map(d => d.timepoint)));
        const colorScale = d3.scaleOrdinal(d3.schemeTableau10).domain(timepoints);

        const linkForce = d3.forceLink()
            .id(d => d._nodeId)
            .distance(s.distance)
            .strength(d => d.strength || 0.6);
        if (links.length) linkForce.links(links);

        const sim = d3.forceSimulation(nodes)
            .force('link', linkForce)
            .force('charge', d3.forceManyBody().strength(s.charge))
            .force('center', d3.forceCenter(width / 2, height / 2))
            .force('collision', d3.forceCollide().radius(s.collide))
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
            .attr('r', 20)
            .attr('fill', d => {
                if (metric) {
                    const val = d[metric];
                    if (val == null) return '#ccc';
                    const range = d3.extent(nodes, n => n[metric]);
                    return d3.scaleSequential(d3.interpolateViridis).domain(range.reverse())(val);
                }
                return colorScale(d.timepoint);
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

        const label = labelG.selectAll('text').data(nodes, d => d._nodeId)
            .join('text')
            .attr('text-anchor', 'middle')
            .attr('dy', 5)
            .text(d => d.subject_id)
            .style('fill', '#fff')
            .style('font-size', '11px')
            .style('font-weight', '600')
            .style('pointer-events', 'none');

        sim.on('tick', () => {
            if (links.length) {
                line.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
                    .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
            }
            circle.attr('cx', d => d.x).attr('cy', d => d.y);
            label.attr('x', d => d.x).attr('y', d => d.y);
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

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#1a1a2e', color: '#eee', fontFamily: 'sans-serif' }}>
            {/* Top bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', background: '#16213e', flexWrap: 'wrap' }}>
                <button onClick={onBack} style={btnStyle('#444')}>← Back</button>
                <strong style={{ fontSize: '1rem' }}>DEXA Visualization</strong>
                <span style={{ color: '#aaa', fontSize: '0.85rem' }}>{csvFilename}</span>

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
                <svg ref={svgRef} style={{ flex: 1, display: 'block' }} />

                {/* Side panel */}
                {selectedNode && (
                    <div style={{ width: 340, background: '#16213e', borderLeft: '2px solid #667eea', overflowY: 'auto', padding: 16 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <strong style={{ color: '#667eea' }}>Subject: {selectedNode.subject_id}</strong>
                            <span onClick={() => setSelectedNode(null)} style={{ cursor: 'pointer', fontSize: '1.2rem', color: '#aaa' }}>×</span>
                        </div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                            <tbody>
                                {Object.entries(selectedNode)
                                    .filter(([k]) => !['_nodeId', 'x', 'y', 'vx', 'vy', 'fx', 'fy', 'index'].includes(k))
                                    .map(([k, v]) => (
                                        <tr key={k} style={{ borderBottom: '1px solid #2a2a4a' }}>
                                            <td style={{ color: '#aaa', padding: '4px 6px', width: '55%', wordBreak: 'break-all' }}>{k}</td>
                                            <td style={{ padding: '4px 6px' }}>{typeof v === 'number' ? v.toFixed(4) : v}</td>
                                        </tr>
                                    ))}
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
    background: '#2a2a4a', color: '#eee', fontSize: '0.85rem'
};

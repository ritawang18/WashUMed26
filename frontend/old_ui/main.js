// --- SVG SETUP ---
let width = window.innerWidth;
let height = window.innerHeight;

const container = d3.select("#chart-area");
const svg = container
    .append("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("viewBox", [0, 0, width, height])
    .attr("preserveAspectRatio", "xMidYMid meet");

window.addEventListener("resize", () => {
    width = window.innerWidth;
    height = window.innerHeight;
    svg.attr("width", width).attr("height", height);
});

// --- HELPERS ---
function parseNumeric(value) {
    if (!value) return undefined;
    const numeric = value.toString().match(/[\d.]+/);
    return numeric ? parseFloat(numeric[0]) : undefined;
}

// --- LOAD DATA ---
d3.csv("/backend/data/Review_SY-08002944_4_3_2025 10_31_21_cleaned.csv").then(mouseData => {

    mouseData.forEach(d => {
        d.sampleId = d["Sample ID"];
        d.patientId = d["Patient ID"];
        d.patient = d["Patient"];
        d.wbc = parseNumeric(d["WBC (10^3/uL)"]);
        d.neutrophils = parseNumeric(d["Neu # (10^3/uL)"]);
        d.lymphocytes = parseNumeric(d["Lym # (10^3/uL)"]);
        d.monocytes = parseNumeric(d["Mon # (10^3/uL)"]);
        d.eosinophils = parseNumeric(d["Eos # (10^3/uL)"]);
        d.basophils = parseNumeric(d["Bas # (10^3/uL)"]);
        d.rbc = parseNumeric(d["RBC (10^6/uL)"]);
        d.hemoglobin = parseNumeric(d["HGB (g/dL)"]);
        d.hematocrit = parseNumeric(d["HCT (%)"]);
        d.platelets = parseNumeric(d["PLT (10^3/uL)"]);
        d.date = d["Date"];
        d.time = d["Time"];
    });

    const metrics = [
        "wbc", "neutrophils", "lymphocytes", "monocytes", "eosinophils",
        "basophils", "rbc", "hemoglobin", "hematocrit", "platelets"
    ];

    // --- RELATIONSHIPS ---
    const relationships = [];
    const sorted = [...mouseData].sort((a, b) => new Date(`${a.date} ${a.time}`) - new Date(`${b.date} ${b.time}`));

    // Temporal links (sequence order)
    for (let i = 0; i < sorted.length - 1; i++) {
        relationships.push({
            source: sorted[i].sampleId,
            target: sorted[i + 1].sampleId,
            type: "temporal",
            strength: 0.8
        });
    }

    // Metric-based similarity links
    const threshold = 1.0;
    for (let i = 0; i < mouseData.length; i++) {
        for (let j = i + 1; j < mouseData.length; j++) {
            for (const metric of metrics) {
                const a = mouseData[i][metric];
                const b = mouseData[j][metric];
                if (a != null && b != null && Math.abs(a - b) <= threshold) {
                    relationships.push({
                        source: mouseData[i].sampleId,
                        target: mouseData[j].sampleId,
                        type: `similar_${metric}`,
                        strength: 0.4
                    });
                }
            }
        }
    }

    // --- ADAPTIVE FORCE SIMULATION ---
    function getForceSettings(nodeCount) {
        if (nodeCount < 20) return { charge: -250, distance: 180, collide: 50, centerY: height / 2.1 };
        if (nodeCount < 50) return { charge: -200, distance: 140, collide: 40, centerY: height / 2.2 };
        if (nodeCount < 100) return { charge: -160, distance: 120, collide: 35, centerY: height / 2.3 };
        if (nodeCount < 200) return { charge: -120, distance: 100, collide: 30, centerY: height / 2.4 };
        return { charge: -90, distance: 85, collide: 25, centerY: height / 2.5 };
    }

    function createSimulation(nodesData, linksData) {
        const settings = getForceSettings(nodesData.length);

        const linkForce = d3.forceLink()
            .id(d => d.sampleId)
            .distance(() => settings.distance)
            .strength(d => d.strength || 0.6);

        const sim = d3.forceSimulation(nodesData)
            .force("link", linkForce)
            .force("charge", d3.forceManyBody().strength(settings.charge))
            .force("center", d3.forceCenter(width / 2, settings.centerY))
            .force("collision", d3.forceCollide().radius(settings.collide))
            .force("x", d3.forceX(width / 2).strength(0.1))
            .force("y", d3.forceY(settings.centerY).strength(0.1));

        if (linksData && linksData.length) linkForce.links(linksData);
        return sim;
    }

    // --- SVG GROUPS ---
    const linkGroup = svg.append("g").attr("class", "links");
    const nodeGroup = svg.append("g").attr("class", "nodes");
    const labelGroup = svg.append("g").attr("class", "labels");

    const originalNodes = mouseData.map(d => ({ ...d }));
    const originalLinks = relationships.map(d => ({ ...d }));

    let simulation = createSimulation(mouseData, relationships);
    updateGraph(originalNodes, []);

    // --- PANEL HANDLING ---
    const dataPanel = d3.select("#data-panel");
    const dataContent = d3.select("#data-content");
    const closePanel = d3.select("#close-panel");
    let currentSelectedNode = null;

    closePanel.on("click", hidePanel);
    function hidePanel() {
        dataPanel.classed("active", false);
        if (currentSelectedNode) {
            currentSelectedNode.transition().attr("r", 20).style("stroke-width", 1.5);
            currentSelectedNode = null;
        }
    }

    function showPanel(d, nodeSel) {
        dataContent.html(createMouseTable(d));
        dataPanel.classed("active", true);
        if (currentSelectedNode && currentSelectedNode.node() !== nodeSel.node()) {
            currentSelectedNode.transition().attr("r", 20).style("stroke-width", 1.5);
        }
        currentSelectedNode = nodeSel;
        nodeSel.transition().attr("r", 26).style("stroke-width", 3);
    }

    // --- UPDATE GRAPH ---
    function updateGraph(nodesData, linksData, metric = null) {
        linkGroup.selectAll("line").remove();
        nodeGroup.selectAll("circle").remove();
        labelGroup.selectAll("text").remove();

        const link = linkGroup.selectAll("line")
            .data(linksData, d => `${d.source}-${d.target}`)
            .join("line")
            .attr("stroke", d => d.color || "#aaa")
            .attr("stroke-width", d => metric ? 2 - (d.diff * 0.1) : 0.8)
            .attr("opacity", d => metric ? 0.8 : 0.3);

        const node = nodeGroup.selectAll("circle")
            .data(nodesData, d => d.sampleId)
            .join("circle")
            .attr("r", 20)
            .attr("fill", d => {
                if (metric) {
                    const val = d[metric];
                    if (val == null) return "#ccc";
                    const range = d3.extent(nodesData, n => n[metric]);
                    const scale = d3.scaleSequential(d3.interpolateViridis).domain(range.reverse());
                    return scale(val);
                }
                if (d.wbc > 15) return "#ff4757";
                if (d.wbc > 12) return "#ff6b6b";
                if (d.wbc > 8) return "#70a1ff";
                return "#7bed9f";
            })
            .attr("stroke", "#222")
            .attr("stroke-width", 1.8)
            .style("cursor", "pointer")
            .on("click", function (event, d) {
                showPanel(d, d3.select(this));
            })
            .call(d3.drag()
                .on("start", dragstarted)
                .on("drag", dragged)
                .on("end", dragended));

        const label = labelGroup.selectAll("text")
            .data(nodesData, d => d.sampleId)
            .join("text")
            .attr("text-anchor", "middle")
            .attr("dy", 5)
            .text(d => d.sampleId)
            .style("fill", "#fff")
            .style("font-size", "14px")
            .style("font-weight", "600")
            .style("pointer-events", "none");

        simulation.stop();
        simulation = createSimulation(nodesData, linksData);
        simulation.alpha(1).restart();

        simulation.on("tick", () => {
            if (linksData && linksData.length) {
                link
                    .attr("x1", d => d.source.x)
                    .attr("y1", d => d.source.y)
                    .attr("x2", d => d.target.x)
                    .attr("y2", d => d.target.y);
            }
            node.attr("cx", d => d.x).attr("cy", d => d.y);
            label.attr("x", d => d.x).attr("y", d => d.y);
        });
    }

    // --- DRAG FUNCTIONS ---
    function dragstarted(event, d) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
    }
    function dragged(event, d) {
        d.fx = event.x; d.fy = event.y;
    }
    function dragended(event, d) {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null; d.fy = null;
    }

    // --- DATA TABLE ---
    function createMouseTable(d) {
        return `
        <h3>Sample: ${d.sampleId}</h3>
        <table>
            <tr><td class="section-header" colspan="3">Blood Cell Counts</td></tr>
            <tr><td>WBC</td><td>${d.wbc}</td><td>10³/uL</td></tr>
            <tr><td>Neutrophils</td><td>${d.neutrophils}</td><td>10³/uL</td></tr>
            <tr><td>Lymphocytes</td><td>${d.lymphocytes}</td><td>10³/uL</td></tr>
            <tr><td>Monocytes</td><td>${d.monocytes}</td><td>10³/uL</td></tr>
            <tr><td>Eosinophils</td><td>${d.eosinophils}</td><td>10³/uL</td></tr>
            <tr><td>Basophils</td><td>${d.basophils}</td><td>10³/uL</td></tr>
            <tr><td class="section-header" colspan="3">Red Blood Cells</td></tr>
            <tr><td>RBC</td><td>${d.rbc}</td><td>10⁶/uL</td></tr>
            <tr><td>Hemoglobin</td><td>${d.hemoglobin}</td><td>g/dL</td></tr>
            <tr><td>Hematocrit</td><td>${d.hematocrit}</td><td>%</td></tr>
            <tr><td>Platelets</td><td>${d.platelets}</td><td>10³/uL</td></tr>
            <tr><td class="section-header" colspan="3">Sample Info</td></tr>
            <tr><td>Date</td><td>${d.date}</td></tr>
            <tr><td>Time</td><td>${d.time}</td></tr>
        </table>`;
    }

    // --- FILTERING ---
    const filterType = document.getElementById("filterType");
    const filterMin = document.getElementById("filterMin");
    const filterMax = document.getElementById("filterMax");
    const applyFilterBtn = document.getElementById("applyFilterBtn");
    const resetFilterBtn = document.getElementById("resetFilterBtn");

    function applyFilter() {
        const metric = filterType.value;
        const minVal = parseFloat(filterMin.value);
        const maxVal = parseFloat(filterMax.value);

        if (metric === "all" || (isNaN(minVal) && isNaN(maxVal))) {
            resetFilter();
            return;
        }

        const filteredNodes = originalNodes.filter(d => {
            const val = d[metric];
            if (val == null) return false;
            if (!isNaN(minVal) && val < minVal) return false;
            if (!isNaN(maxVal) && val > maxVal) return false;
            return true;
        });

        const filteredLinks = [];
        const proximityThreshold = d3.max(filteredNodes, d => d[metric]) - d3.min(filteredNodes, d => d[metric]);
        const colorScale = d3.scaleSequential(d3.interpolateRdYlBu).domain([0, proximityThreshold]);

        for (let i = 0; i < filteredNodes.length; i++) {
            for (let j = i + 1; j < filteredNodes.length; j++) {
                const a = filteredNodes[i][metric];
                const b = filteredNodes[j][metric];
                if (a != null && b != null) {
                    const diff = Math.abs(a - b);
                    filteredLinks.push({
                        source: filteredNodes[i].sampleId,
                        target: filteredNodes[j].sampleId,
                        diff,
                        color: colorScale(diff),
                        strength: 1 - (diff / proximityThreshold)
                    });
                }
            }
        }

        updateGraph(filteredNodes, filteredLinks, metric);
    }

    function resetFilter() {
        filterType.value = "all";
        filterMin.value = "";
        filterMax.value = "";
        updateGraph(originalNodes, []);
    }

    applyFilterBtn.addEventListener("click", applyFilter);
    resetFilterBtn.addEventListener("click", resetFilter);

});

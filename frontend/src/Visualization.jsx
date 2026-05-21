import React, { useEffect, useRef, useState, useMemo } from 'react';

export default function Visualization({ session }) {
    const plotRef = useRef(null);
    const overtimeRef = useRef(null);
    const overtimeSingleRef = useRef(null);
    const modalPlotRef = useRef(null);

    const [selectedNode, setSelectedNode] = useState(null);
    const [allNodes, setAllNodes] = useState([]);
    const [allMetrics, setAllMetrics] = useState([]);

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const [chartType, setChartType] = useState('scatter');
    const [dataType, setDataType] = useState('dexa'); // 'dexa' | 'hematology'

    const [xAxis, setXAxis] = useState('');
    const [yAxis, setYAxis] = useState('');
    const [numVar, setNumVar] = useState('');
    const [denVar, setDenVar] = useState('');
    const [singleVar, setSingleVar] = useState('');

    const [modal, setModal] = useState(null); // { subject, variable }

    const [editingCell, setEditingCell] = useState(null); // { recordId, field }
    const [editValue, setEditValue] = useState('');

    const [groupings, setGroupings] = useState({}); // { subject_id: { flag, gender, dob, genotype } }
    const [groupingInput, setGroupingInput] = useState({
        flag: 'experiment',
        gender: '',
        dob: '',
        genotype: ''
    });
    const [groupingSaveStatus, setGroupingSaveStatus] = useState(null); // 'saving' | 'saved' | 'error'

    const [subgroupConstraints, setSubgroupConstraints] = useState([]); // [{ field, value }]
    const [addingConstraint, setAddingConstraint] = useState(null);
    const [showSubgroupAvg, setShowSubgroupAvg] = useState(false);

    const [plotConstraints, setPlotConstraints] = useState([]); // [{ field, value }]
    const [addingPlotConstraint, setAddingPlotConstraint] = useState(null);

    const [customGroupings, setCustomGroupings] = useState([]);
    const [customGroupingMembers, setCustomGroupingMembers] = useState({});
    const [showCustomGroupingPanel, setShowCustomGroupingPanel] = useState(false);
    const [newCustomGrouping, setNewCustomGrouping] = useState({
        grouping_name: '',
        grouping_type: 'range',
        metric_field: '',
        range_min: '',
        range_max: '',
        selected_subjects: ''
    });
    const [customGroupingStatus, setCustomGroupingStatus] = useState(null);
    const [deletingGroupingId, setDeletingGroupingId] = useState(null);
    const [customGroupingErrorMessage, setCustomGroupingErrorMessage] = useState('');

    const getUserId = () =>
        session?.user?.id ||
        localStorage.getItem('user_id') ||
        localStorage.getItem('supabase_user_id') ||
        '';

    const apiFetch = (url, options = {}) => {
        const userId = getUserId();
        const headers = {
            ...(options.headers || {}),
            ...(userId ? { 'X-User-Id': userId } : {}),
        };

        return fetch(url, {
            ...options,
            headers,
        });
    };

    const getRecordsEndpoint = () => {
        const userId = getUserId();

        if (dataType === 'hematology') {
            return `/api/hematology/reports?user_id=${encodeURIComponent(userId)}`;
        }

        return `/api/dexa-records?user_id=${encodeURIComponent(userId)}`;
    };

    const getVisualizationTitle = () => {
        return dataType === 'hematology' ? 'Hemovat Visualization' : 'DEXA Visualization';
    };

    const normalizeVisualizationRows = (rows, selectedDataType) => {
        const nonNumericFields = new Set([
            'subject_id',
            'timepoint',
            'batch',
            'filename',
            'id',
            'session_id',
            'user_id',
            'data_type',
            'has_image_data',

            // Hemovat metadata fields
            'patient',
            'owner_last_name',
            'gender',
            'species',
            'patient_id',
            'mode',
            'age',
            'delivery_time',
            'draw_time',
            'time_of_analysis',
            'time_of_printing',
            'operator',
            'veterinarian',
            'comments',
        ]);

        return rows.map((row, i) => {
            const d = {
                ...row,
                data_type: selectedDataType,
            };

            Object.keys(d).forEach(k => {
                if (nonNumericFields.has(k)) {
                    if (d[k] !== null && d[k] !== undefined) {
                        d[k] = String(d[k]).trim();
                    }
                    return;
                }

                const val = parseFloat(d[k]);
                if (!isNaN(val) && d[k] !== '') {
                    d[k] = val;
                }
            });

            d._nodeId = `${d.subject_id}_${d.timepoint}_${selectedDataType}_${i}`;
            return d;
        });
    };

    useEffect(() => {
        if (!session?.user?.id) {
            setError('User not authenticated');
            setLoading(false);
            return;
        }

        const userId = getUserId();

        setLoading(true);
        setError(null);
        setSelectedNode(null);
        setModal(null);

        Promise.all([
            apiFetch(`/api/subject-groupings?user_id=${encodeURIComponent(userId)}`).then(r => r.json()),
            apiFetch(`/api/custom-groupings?user_id=${encodeURIComponent(userId)}`).then(r => r.json()),
            apiFetch(getRecordsEndpoint()).then(r => r.json())
        ])
            .then(([groupingsData, customGroupingsData, recordsData]) => {
                const groupingMap = {};

                if (Array.isArray(groupingsData)) {
                    groupingsData.forEach(({ subject_id, flag, gender, dob, genotype }) => {
                        const sid = String(subject_id).trim();

                        groupingMap[sid] = {
                            flag: flag || '',
                            gender: gender || '',
                            dob: dob || '',
                            genotype: genotype || ''
                        };
                    });
                }

                setGroupings(groupingMap);

                const selectedCustomGroupings = Array.isArray(customGroupingsData)
                    ? customGroupingsData.filter(cg => {
                        const cgType = cg.data_type === 'hemovat'
                            ? 'hematology'
                            : (cg.data_type || 'dexa');

                        return cgType === dataType;
                    })
                    : [];

                setCustomGroupings(selectedCustomGroupings);

                const membersFetches = selectedCustomGroupings.map(cg =>
                    apiFetch(`/api/custom-groupings/${encodeURIComponent(cg.id)}/members?user_id=${encodeURIComponent(userId)}`)
                        .then(r => r.json())
                );

                return Promise.all(membersFetches).then(membersResults => {
                    const membersMap = {};

                    membersResults.forEach((result, idx) => {
                        const cgId = selectedCustomGroupings[idx].id;
                        membersMap[cgId] = result.subjects || [];
                    });

                    setCustomGroupingMembers(membersMap);

                    return recordsData;
                });
            })
            .then(data => {
                if (!Array.isArray(data) || data.length === 0) {
                    setAllNodes([]);
                    setAllMetrics([]);
                    setXAxis('');
                    setYAxis('');
                    setNumVar('');
                    setDenVar('');
                    setSingleVar('');
                    setLoading(false);
                    return;
                }

                const normalizedData = normalizeVisualizationRows(data, dataType);

                const numericCols = new Set();

                normalizedData.forEach(d => {
                    Object.keys(d).forEach(k => {
                        if (typeof d[k] === 'number') {
                            numericCols.add(k);
                        }
                    });
                });

                const metrics = Array.from(numericCols).filter(k => k !== '_nodeId');

                setAllMetrics(metrics);
                setAllNodes(normalizedData);
                setXAxis(metrics[0] || '');
                setYAxis(metrics[1] || metrics[0] || '');
                setNumVar(metrics[0] || '');
                setDenVar(metrics[1] || metrics[0] || '');
                setSingleVar(metrics[0] || '');
                setLoading(false);
            })
            .catch(err => {
                setError(err.message);
                setLoading(false);
            });
    }, [session?.user?.id, dataType]);

    const filteredNodes = useMemo(() => {
        if (!plotConstraints.length) return allNodes;

        return allNodes.filter(d =>
            matchesSubgroupFilter(d.subject_id, plotConstraints, groupings)
        );
    }, [allNodes, plotConstraints, groupings, customGroupingMembers]);

    useEffect(() => {
        if (chartType !== 'scatter' || !plotRef.current || !filteredNodes.length || !xAxis || !yAxis) return;

        const Plotly = window.Plotly;
        if (!Plotly) return;

        const sortedTimepoints = Array.from(new Set(filteredNodes.map(d => d.timepoint)))
            .sort((a, b) => timepointToWeek(a) - timepointToWeek(b));

        const genderSize = subjectId => {
            const g = (groupings[subjectId]?.gender || '').trim().toUpperCase();

            if (g === 'M' || g === 'MALE') return 14;
            if (g === 'F' || g === 'FEMALE') return 8;

            return 10;
        };

        const subjectTraces = sortedTimepoints.map(tp => {
            const pts = filteredNodes.filter(d => d.timepoint === tp);

            return {
                x: pts.map(d => d[xAxis]),
                y: pts.map(d => d[yAxis]),
                text: pts.map(d => d.subject_id),
                customdata: pts,
                mode: 'markers',
                type: 'scatter',
                name: String(tp),
                legendgroup: 'timepoints',
                marker: {
                    size: pts.map(d => genderSize(d.subject_id)),
                    symbol: pts.map(d => getSymbolForSubject(d.subject_id)),
                    opacity: 0.85
                },
                hovertemplate: `<b>%{text}</b><br>${xAxis}: %{x}<br>${yAxis}: %{y}<extra>%{fullData.name}</extra>`,
            };
        });

        const flagLegend = [
            { name: 'Experiment', symbol: 'x', color: '#444' },
            { name: 'Control', symbol: 'star', color: '#444' },
        ].map(({ name, symbol, color }) => ({
            x: [null],
            y: [null],
            mode: 'markers',
            type: 'scatter',
            name,
            legendgroup: 'flag',
            legendgrouptitle: { text: 'Flag' },
            marker: { symbol, size: 10, color },
            hoverinfo: 'none',
            showlegend: true,
        }));

        const genderLegend = [
            { name: 'M (Male)', size: 14 },
            { name: 'F (Female)', size: 8 },
        ].map(({ name, size }) => ({
            x: [null],
            y: [null],
            mode: 'markers',
            type: 'scatter',
            name,
            legendgroup: 'gender',
            legendgrouptitle: { text: 'Gender' },
            marker: { size, color: '#555', opacity: 0.85 },
            hoverinfo: 'none',
            showlegend: true,
        }));

        const customGroupingSymbols = [
            'triangle-up',
            'triangle-down',
            'diamond',
            'square',
            'pentagon',
            'hexagon'
        ];

        const customGroupingLegend = customGroupings.map((cg, idx) => ({
            x: [null],
            y: [null],
            mode: 'markers',
            type: 'scatter',
            name: cg.name || cg.grouping_name || 'Custom Group',
            legendgroup: 'custom_grouping',
            legendgrouptitle: { text: 'Custom Grouping' },
            marker: {
                symbol: customGroupingSymbols[idx % customGroupingSymbols.length],
                size: 10,
                color: '#888'
            },
            hoverinfo: 'none',
            showlegend: true,
        }));

        const layout = {
            autosize: true,
            xaxis: { title: { text: xAxis }, gridcolor: '#c0d8e8' },
            yaxis: { title: { text: yAxis }, gridcolor: '#c0d8e8' },
            legend: {
                title: { text: 'Timepoint' },
                bgcolor: 'rgba(197,220,232,0.8)',
                bordercolor: '#aaa',
                borderwidth: 1,
                tracegroupgap: 12
            },
            paper_bgcolor: '#b8d4e3',
            plot_bgcolor: '#d0e8f2',
            margin: { l: 70, r: 20, t: 20, b: 70 },
            font: { family: 'sans-serif', color: '#1a2a3a' },
        };

        Plotly.newPlot(
            plotRef.current,
            [...subjectTraces, ...flagLegend, ...genderLegend, ...customGroupingLegend],
            layout,
            {
                responsive: true,
                editable: true,
                edits: {
                    axisTitleText: true,
                    titleText: false,
                    legendText: true
                }
            }
        ).then(() => {
            plotRef.current.on('plotly_click', data => {
                if (data.points && data.points[0]) {
                    setSelectedNode(data.points[0].customdata);
                }
            });
        });
    }, [
        filteredNodes,
        chartType,
        xAxis,
        yAxis,
        groupings,
        customGroupings,
        customGroupingMembers
    ]);

    useEffect(() => {
        if (chartType !== 'overtime' || !overtimeRef.current || !filteredNodes.length || !numVar || !denVar) return;

        const Plotly = window.Plotly;
        if (!Plotly) return;

        const sortedTimepoints = Array.from(new Set(filteredNodes.map(d => d.timepoint)))
            .sort((a, b) => timepointToWeek(a) - timepointToWeek(b));

        const subjects = Array.from(new Set(filteredNodes.map(d => d.subject_id))).sort();

        const otGenderSize = subjectId => {
            const g = (groupings[subjectId]?.gender || '').trim().toUpperCase();

            if (g === 'M' || g === 'MALE') return 14;
            if (g === 'F' || g === 'FEMALE') return 8;

            return 9;
        };

        const subjectTraces = subjects.map(subj => {
            const rows = filteredNodes
                .filter(d => d.subject_id === subj)
                .sort((a, b) => timepointToWeek(a.timepoint) - timepointToWeek(b.timepoint));

            const x = [];
            const y = [];
            const text = [];
            const customdata = [];

            rows.forEach(d => {
                const num = d[numVar];
                const den = d[denVar];

                if (typeof num === 'number' && typeof den === 'number' && den !== 0) {
                    x.push(String(d.timepoint));
                    y.push(num / den);
                    text.push(
                        `Subject: ${subj}<br>` +
                        `Timepoint: ${d.timepoint}<br>` +
                        `${numVar}: ${num.toFixed(4)}<br>` +
                        `${denVar}: ${den.toFixed(4)}<br>` +
                        `Ratio: ${(num / den).toFixed(4)}`
                    );
                    customdata.push(d);
                }
            });

            return {
                x,
                y,
                text,
                customdata,
                mode: 'lines+markers',
                type: 'scatter',
                name: subj,
                legendgroup: 'subjects',
                hovertemplate: '%{text}<extra></extra>',
                marker: {
                    size: otGenderSize(subj),
                    symbol: getSymbolForSubject(subj),
                },
                line: { width: 2 },
            };
        }).filter(t => t.x.length > 0);

        const flagLegend = [
            { name: 'Experiment', symbol: 'x', color: '#444' },
            { name: 'Control', symbol: 'star', color: '#444' },
        ].map(({ name, symbol, color }) => ({
            x: [null],
            y: [null],
            mode: 'markers',
            type: 'scatter',
            name,
            legendgroup: 'flag',
            legendgrouptitle: { text: 'Flag' },
            marker: { symbol, size: 10, color },
            hoverinfo: 'none',
            showlegend: true,
        }));

        const otGenderLegend = [
            { name: 'M (Male)', size: 14 },
            { name: 'F (Female)', size: 8 },
        ].map(({ name, size }) => ({
            x: [null],
            y: [null],
            mode: 'markers',
            type: 'scatter',
            name,
            legendgroup: 'gender',
            legendgrouptitle: { text: 'Gender' },
            marker: { size, color: '#555', opacity: 0.85 },
            hoverinfo: 'none',
            showlegend: true,
        }));

        const customGroupingSymbols = [
            'triangle-up',
            'triangle-down',
            'diamond',
            'square',
            'pentagon',
            'hexagon'
        ];

        const customGroupingLegend = customGroupings.map((cg, idx) => ({
            x: [null],
            y: [null],
            mode: 'markers',
            type: 'scatter',
            name: cg.name || cg.grouping_name || 'Custom Group',
            legendgroup: 'custom_grouping',
            legendgrouptitle: { text: 'Custom Grouping' },
            marker: {
                symbol: customGroupingSymbols[idx % customGroupingSymbols.length],
                size: 10,
                color: '#888'
            },
            hoverinfo: 'none',
            showlegend: true,
        }));

        const avgTraces = [];

        if (showSubgroupAvg) {
            const matchingSubjects = new Set(
                subjects.filter(s => matchesSubgroupFilter(s, subgroupConstraints, groupings))
            );

            if (matchingSubjects.size > 0) {
                avgTraces.push(
                    buildAvgTrace(
                        matchingSubjects,
                        filteredNodes,
                        sortedTimepoints,
                        d => {
                            const num = d[numVar];
                            const den = d[denVar];

                            return (typeof num === 'number' && typeof den === 'number' && den !== 0)
                                ? num / den
                                : NaN;
                        },
                        buildSubgroupLabel(subgroupConstraints)
                    )
                );
            }
        }

        const traces = [
            ...subjectTraces,
            ...flagLegend,
            ...otGenderLegend,
            ...customGroupingLegend,
            ...avgTraces
        ];

        const layout = {
            autosize: true,
            xaxis: {
                title: { text: 'Timepoint' },
                categoryorder: 'array',
                categoryarray: sortedTimepoints.map(String),
                gridcolor: '#c0d8e8',
            },
            yaxis: { title: { text: `${numVar} / ${denVar}` }, gridcolor: '#c0d8e8' },
            legend: {
                bgcolor: 'rgba(197,220,232,0.8)',
                bordercolor: '#aaa',
                borderwidth: 1,
                tracegroupgap: 12
            },
            paper_bgcolor: '#b8d4e3',
            plot_bgcolor: '#d0e8f2',
            margin: { l: 70, r: 20, t: 20, b: 70 },
            font: { family: 'sans-serif', color: '#1a2a3a' },
        };

        Plotly.newPlot(
            overtimeRef.current,
            traces,
            layout,
            {
                responsive: true,
                editable: true,
                edits: {
                    axisTitleText: true,
                    titleText: false,
                    legendText: true
                }
            }
        ).then(() => {
            overtimeRef.current.on('plotly_click', data => {
                if (data.points && data.points[0]) {
                    setSelectedNode(data.points[0].customdata);
                }
            });
        });
    }, [
        filteredNodes,
        chartType,
        numVar,
        denVar,
        groupings,
        showSubgroupAvg,
        subgroupConstraints,
        customGroupings,
        customGroupingMembers
    ]);

    useEffect(() => {
        if (chartType !== 'overtime_single' || !overtimeSingleRef.current || !filteredNodes.length || !singleVar) return;

        const Plotly = window.Plotly;
        if (!Plotly) return;

        const sortedTimepoints = Array.from(new Set(filteredNodes.map(d => d.timepoint)))
            .sort((a, b) => timepointToWeek(a) - timepointToWeek(b));

        const subjects = Array.from(new Set(filteredNodes.map(d => d.subject_id))).sort();

        const otGenderSize = subjectId => {
            const g = (groupings[subjectId]?.gender || '').trim().toUpperCase();

            if (g === 'M' || g === 'MALE') return 14;
            if (g === 'F' || g === 'FEMALE') return 8;

            return 9;
        };

        const subjectTraces = subjects.map(subj => {
            const rows = filteredNodes
                .filter(d => d.subject_id === subj)
                .sort((a, b) => timepointToWeek(a.timepoint) - timepointToWeek(b.timepoint));

            const x = [];
            const y = [];
            const text = [];
            const customdata = [];

            rows.forEach(d => {
                const val = d[singleVar];

                if (typeof val === 'number') {
                    x.push(String(d.timepoint));
                    y.push(val);
                    text.push(
                        `Subject: ${subj}<br>` +
                        `Timepoint: ${d.timepoint}<br>` +
                        `${singleVar}: ${val.toFixed(4)}`
                    );
                    customdata.push(d);
                }
            });

            return {
                x,
                y,
                text,
                customdata,
                mode: 'lines+markers',
                type: 'scatter',
                name: subj,
                legendgroup: 'subjects',
                hovertemplate: '%{text}<extra></extra>',
                marker: {
                    size: otGenderSize(subj),
                    symbol: getSymbolForSubject(subj),
                },
                line: { width: 2 },
            };
        }).filter(t => t.x.length > 0);

        const flagLegend = [
            { name: 'Experiment', symbol: 'x', color: '#444' },
            { name: 'Control', symbol: 'star', color: '#444' },
        ].map(({ name, symbol, color }) => ({
            x: [null],
            y: [null],
            mode: 'markers',
            type: 'scatter',
            name,
            legendgroup: 'flag',
            legendgrouptitle: { text: 'Flag' },
            marker: { symbol, size: 10, color },
            hoverinfo: 'none',
            showlegend: true,
        }));

        const otGenderLegend = [
            { name: 'M (Male)', size: 14 },
            { name: 'F (Female)', size: 8 },
        ].map(({ name, size }) => ({
            x: [null],
            y: [null],
            mode: 'markers',
            type: 'scatter',
            name,
            legendgroup: 'gender',
            legendgrouptitle: { text: 'Gender' },
            marker: { size, color: '#555', opacity: 0.85 },
            hoverinfo: 'none',
            showlegend: true,
        }));

        const customGroupingSymbols = [
            'triangle-up',
            'triangle-down',
            'diamond',
            'square',
            'pentagon',
            'hexagon'
        ];

        const customGroupingLegend = customGroupings.map((cg, idx) => ({
            x: [null],
            y: [null],
            mode: 'markers',
            type: 'scatter',
            name: cg.name || cg.grouping_name || 'Custom Group',
            legendgroup: 'custom_grouping',
            legendgrouptitle: { text: 'Custom Grouping' },
            marker: {
                symbol: customGroupingSymbols[idx % customGroupingSymbols.length],
                size: 10,
                color: '#888'
            },
            hoverinfo: 'none',
            showlegend: true,
        }));

        const avgTraces = [];

        if (showSubgroupAvg) {
            const matchingSubjects = new Set(
                subjects.filter(s => matchesSubgroupFilter(s, subgroupConstraints, groupings))
            );

            if (matchingSubjects.size > 0) {
                avgTraces.push(
                    buildAvgTrace(
                        matchingSubjects,
                        filteredNodes,
                        sortedTimepoints,
                        d => {
                            const v = d[singleVar];
                            return typeof v === 'number' ? v : NaN;
                        },
                        buildSubgroupLabel(subgroupConstraints)
                    )
                );
            }
        }

        const layout = {
            autosize: true,
            xaxis: {
                title: { text: 'Timepoint' },
                categoryorder: 'array',
                categoryarray: sortedTimepoints.map(String),
                gridcolor: '#c0d8e8',
            },
            yaxis: { title: { text: singleVar }, gridcolor: '#c0d8e8' },
            legend: {
                bgcolor: 'rgba(197,220,232,0.8)',
                bordercolor: '#aaa',
                borderwidth: 1,
                tracegroupgap: 12
            },
            paper_bgcolor: '#b8d4e3',
            plot_bgcolor: '#d0e8f2',
            margin: { l: 70, r: 20, t: 20, b: 70 },
            font: { family: 'sans-serif', color: '#1a2a3a' },
        };

        Plotly.newPlot(
            overtimeSingleRef.current,
            [
                ...subjectTraces,
                ...flagLegend,
                ...otGenderLegend,
                ...customGroupingLegend,
                ...avgTraces
            ],
            layout,
            {
                responsive: true,
                editable: true,
                edits: {
                    axisTitleText: true,
                    titleText: false,
                    legendText: true
                }
            }
        ).then(() => {
            overtimeSingleRef.current.on('plotly_click', data => {
                if (data.points && data.points[0]) {
                    setSelectedNode(data.points[0].customdata);
                }
            });
        });
    }, [
        filteredNodes,
        chartType,
        singleVar,
        groupings,
        showSubgroupAvg,
        subgroupConstraints,
        customGroupings,
        customGroupingMembers
    ]);

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
            text: rows.map(d =>
                `Timepoint: ${d.timepoint}<br>${modal.variable}: ${d[modal.variable].toFixed(4)}`
            ),
            mode: rows.length > 1 ? 'lines+markers' : 'markers',
            type: 'scatter',
            name: modal.subject,
            hovertemplate: '%{text}<extra></extra>',
            marker: { size: 10, color: '#667eea' },
            line: { color: '#667eea', width: 2 },
        };

        Plotly.newPlot(
            modalPlotRef.current,
            [trace],
            {
                autosize: true,
                title: {
                    text: `${modal.variable} — ${modal.subject}`,
                    font: { size: 14, color: '#1a2a3a' }
                },
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
            },
            { responsive: true }
        );
    }, [modal, allNodes]);

    const STANDARD_CONSTRAINT_FIELDS = [
        { field: 'flag', label: 'Flag', options: ['experiment', 'control'] },
        { field: 'gender', label: 'Gender', options: ['M', 'F'] },
        { field: 'genotype', label: 'Genotype', type: 'text' },
        { field: 'dob', label: 'Date of Birth', type: 'text' },
    ];

    const CONSTRAINT_FIELDS = useMemo(() => {
        const customFields = customGroupings.map(cg => ({
            field: `custom:${String(cg.id)}`,
            label: cg.name || cg.grouping_name || 'Custom Group',
            options: ['Member', 'Not Member'],
            type: 'custom_grouping',
            groupingId: String(cg.id),
        }));

        return [...STANDARD_CONSTRAINT_FIELDS, ...customFields];
    }, [customGroupings]);

    function matchesSubgroupFilter(subjectId, constraints, groupingsMap) {
        const sid = String(subjectId).trim();
        const g = groupingsMap[sid] || {};

        for (const { field, value } of constraints) {
            if (field === 'flag') {
                if ((g.flag || '') !== value) return false;

            } else if (field === 'gender') {
                const gv = (g.gender || '').trim().toUpperCase();
                const want = value.toUpperCase();

                const ok =
                    (want === 'M' && (gv === 'M' || gv === 'MALE')) ||
                    (want === 'F' && (gv === 'F' || gv === 'FEMALE'));

                if (!ok) return false;

            } else if (field === 'genotype') {
                const gt = (g.genotype || '').trim().toLowerCase();

                if (!gt.includes(value.trim().toLowerCase())) return false;

            } else if (field === 'dob') {
                const db = (g.dob || '').trim().toLowerCase();

                if (!db.includes(value.trim().toLowerCase())) return false;

            } else if (field.startsWith('custom:')) {
                const groupingId = field.replace('custom:', '');
                const isMember = isSubjectInCustomGrouping(sid, groupingId);

                if (value === 'Member' && !isMember) return false;
                if (value === 'Not Member' && isMember) return false;
            }
        }

        return true;
    }

    function buildSubgroupLabel(constraints) {
        if (!constraints.length) return 'Avg (All)';

        const labels = constraints.map(({ field, value }) => {
            const def = CONSTRAINT_FIELDS.find(f => f.field === field);

            if (field === 'flag') {
                return value.charAt(0).toUpperCase() + value.slice(1);
            }

            if (field.startsWith('custom:')) {
                return `${def?.label || 'Custom Group'}: ${value}`;
            }

            return `${def?.label || field}: ${value}`;
        });

        return `Avg (${labels.join(', ')})`;
    }

    function buildAvgTrace(matchingSubjects, nodes, sortedTimepoints, getValue, label) {
        const x = [];
        const y = [];

        sortedTimepoints.forEach(tp => {
            const vals = [];

            nodes.forEach(d => {
                if (d.timepoint === tp && matchingSubjects.has(d.subject_id)) {
                    const v = getValue(d);

                    if (typeof v === 'number' && isFinite(v)) {
                        vals.push(v);
                    }
                }
            });

            if (vals.length > 0) {
                x.push(String(tp));
                y.push(vals.reduce((a, b) => a + b, 0) / vals.length);
            }
        });

        return {
            x,
            y,
            mode: 'lines+markers',
            type: 'scatter',
            name: label,
            legendgroup: 'subgroup_avg',
            legendgrouptitle: { text: 'Subgroup Avg' },
            line: { dash: 'dot', width: 3, color: '#e74c3c' },
            marker: { size: 10, color: '#e74c3c', symbol: 'diamond' },
            hovertemplate: `${label}<br>Timepoint: %{x}<br>Avg: %{y:.4f}<extra></extra>`,
        };
    }

    function timepointToWeek(tp) {
        if (!tp) return 999;

        const s = String(tp).toLowerCase();
        const m = s.match(/(\d+)/);

        return m ? parseInt(m[1], 10) : 999;
    }

    function isSubjectInCustomGrouping(subjectId, groupingId) {
        const members = customGroupingMembers[String(groupingId)] || [];
        return members.map(String).includes(String(subjectId));
    }

    function getSymbolForSubject(subjectId) {
        const customGroupingSymbols = [
            'triangle-up',
            'triangle-down',
            'diamond',
            'square',
            'pentagon',
            'hexagon'
        ];

        const SYMBOL = {
            experiment: 'x',
            control: 'star',
            '': 'circle',
            undefined: 'circle'
        };

        for (let i = 0; i < customGroupings.length; i++) {
            if (isSubjectInCustomGrouping(subjectId, customGroupings[i].id)) {
                return customGroupingSymbols[i % customGroupingSymbols.length];
            }
        }

        const g = groupings[subjectId]?.flag || '';
        return SYMBOL[g] || 'circle';
    }

    useEffect(() => {
        if (!selectedNode) return;

        const g = groupings[selectedNode.subject_id];

        if (g) {
            setGroupingInput({
                flag: g.flag || 'experiment',
                gender: g.gender || '',
                dob: g.dob || '',
                genotype: g.genotype || ''
            });
        } else {
            setGroupingInput({
                flag: 'experiment',
                gender: '',
                dob: '',
                genotype: ''
            });
        }
    }, [selectedNode, groupings]);

    async function saveEdit(recordId, field, originalValue) {
        if (field === 'data_type') {
            setEditingCell(null);
            return;
        }

        const isNum = typeof originalValue === 'number';
        const parsed = isNum ? parseFloat(editValue) : editValue;

        if (isNum && isNaN(parsed)) {
            setEditingCell(null);
            return;
        }

        const userId = getUserId();

        const endpoint = dataType === 'hematology'
            ? `/api/hematology/reports/${encodeURIComponent(recordId)}?user_id=${encodeURIComponent(userId)}`
            : `/api/dexa-records/${encodeURIComponent(recordId)}?user_id=${encodeURIComponent(userId)}`;

        try {
            await apiFetch(endpoint, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ [field]: parsed }),
            });

            setAllNodes(prev =>
                prev.map(n => n.id === recordId ? { ...n, [field]: parsed } : n)
            );

            setSelectedNode(prev =>
                prev ? { ...prev, [field]: parsed } : prev
            );
        } catch (e) {
            console.error(e);
        }

        setEditingCell(null);
    }

    async function deleteCustomGrouping(groupingId) {
        const id = String(groupingId);
        const userId = getUserId();

        if (!userId) {
            console.error('User not authenticated');
            return;
        }

        const ok = window.confirm('Delete this custom grouping? This will remove it from all subjects.');
        if (!ok) return;

        setDeletingGroupingId(id);

        try {
            const res = await apiFetch(`/api/custom-groupings/${encodeURIComponent(id)}?user_id=${encodeURIComponent(userId)}`, {
                method: 'DELETE',
            });

            const json = await res.json();

            if (!res.ok || json.error) {
                console.error('Custom grouping delete error:', json.error || json);
                setCustomGroupingStatus('error');
                return;
            }

            setCustomGroupings(prev =>
                prev.filter(cg => String(cg.id) !== id)
            );

            setCustomGroupingMembers(prev => {
                const next = { ...prev };
                delete next[id];
                return next;
            });

            setCustomGroupingStatus('saved');
        } catch (e) {
            console.error('Custom grouping delete failed:', e);
            setCustomGroupingStatus('error');
        } finally {
            setDeletingGroupingId(null);
            setTimeout(() => setCustomGroupingStatus(null), 2500);
        }
    }

    if (loading) {
        return (
            <div style={{ color: '#eee', padding: 40, background: '#b8d4e3', height: '100vh' }}>
                Loading records...
            </div>
        );
    }

    if (error) {
        return (
            <div style={{ color: '#f88', padding: 40, background: '#b8d4e3', height: '100vh' }}>
                Error: {error}
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#b8d4e3', color: '#1a2a3a', fontFamily: 'sans-serif' }}>
            {/* Top bar */}
            <div style={{ background: '#c5dce8', display: 'flex', flexDirection: 'column' }}>
                {/* Row 1 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: '1rem' }}>{getVisualizationTitle()}:</strong>

                    <select
                        value={dataType}
                        onChange={e => {
                            const nextType = e.target.value;

                            setDataType(nextType);
                            setSelectedNode(null);
                            setModal(null);
                            setPlotConstraints([]);
                            setSubgroupConstraints([]);
                            setCustomGroupingMembers({});
                            setCustomGroupings([]);
                            setShowSubgroupAvg(false);

                            setNewCustomGrouping({
                                grouping_name: '',
                                grouping_type: 'range',
                                metric_field: '',
                                range_min: '',
                                range_max: '',
                                selected_subjects: ''
                            });
                        }}
                        style={inputStyle}
                    >
                        <option value="dexa">DEXA</option>
                        <option value="hematology">Hemovat</option>
                    </select>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <label style={{ fontSize: '0.85rem' }}>Chart:</label>

                        <select
                            value={chartType}
                            onChange={e => {
                                setChartType(e.target.value);
                                setSelectedNode(null);
                            }}
                            style={inputStyle}
                        >
                            <option value="scatter">Scatter Plot</option>
                            <option value="overtime_single">Over Time Plot</option>
                            <option value="overtime">Ratio Over Time Plot</option>
                        </select>
                    </div>

                    {chartType === 'scatter' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <label style={{ fontSize: '0.85rem' }}>X:</label>

                            <select value={xAxis} onChange={e => setXAxis(e.target.value)} style={inputStyle}>
                                {allMetrics.map(f => (
                                    <option key={f} value={f}>{f}</option>
                                ))}
                            </select>

                            <label style={{ fontSize: '0.85rem' }}>Y:</label>

                            <select value={yAxis} onChange={e => setYAxis(e.target.value)} style={inputStyle}>
                                {allMetrics.map(f => (
                                    <option key={f} value={f}>{f}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {chartType === 'overtime_single' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <label style={{ fontSize: '0.85rem' }}>Variable:</label>

                            <select value={singleVar} onChange={e => setSingleVar(e.target.value)} style={inputStyle}>
                                {allMetrics.map(f => (
                                    <option key={f} value={f}>{f}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {chartType === 'overtime' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <label style={{ fontSize: '0.85rem' }}>Numerator:</label>

                            <select value={numVar} onChange={e => setNumVar(e.target.value)} style={inputStyle}>
                                {allMetrics.map(f => (
                                    <option key={f} value={f}>{f}</option>
                                ))}
                            </select>

                            <label style={{ fontSize: '0.85rem' }}>÷ Denominator:</label>

                            <select value={denVar} onChange={e => setDenVar(e.target.value)} style={inputStyle}>
                                {allMetrics.map(f => (
                                    <option key={f} value={f}>{f}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {(chartType === 'overtime' || chartType === 'overtime_single') && (() => {
                        const usedFields = new Set(subgroupConstraints.map(c => c.field));
                        const availableFields = CONSTRAINT_FIELDS.filter(f => !usedFields.has(f.field));
                        const chipColors = {
                            flag: '#7b6cf6',
                            gender: '#2980b9',
                            genotype: '#27ae60',
                            dob: '#d35400',
                            custom: '#8e44ad'
                        };

                        return (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', borderLeft: '1px solid #aac', paddingLeft: 12 }}>
                                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#3a3a6a', whiteSpace: 'nowrap' }}>
                                    Show Grouping Avg:
                                </label>

                                {subgroupConstraints.map(({ field, value }) => {
                                    const def = CONSTRAINT_FIELDS.find(f => f.field === field);

                                    return (
                                        <span
                                            key={field}
                                            style={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: 4,
                                                background: field.startsWith('custom:')
                                                    ? chipColors.custom
                                                    : (chipColors[field] || '#555'),
                                                color: '#fff',
                                                borderRadius: 12,
                                                padding: '2px 8px',
                                                fontSize: '0.78rem',
                                                whiteSpace: 'nowrap'
                                            }}
                                        >
                                            {def?.label}: {value}
                                            <span
                                                onClick={() => setSubgroupConstraints(p => p.filter(c => c.field !== field))}
                                                style={{ cursor: 'pointer', fontWeight: 700, marginLeft: 2 }}
                                            >
                                                ×
                                            </span>
                                        </span>
                                    );
                                })}

                                {addingConstraint !== null && (
                                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                        <select
                                            autoFocus
                                            value={addingConstraint.field}
                                            onChange={e => setAddingConstraint({ field: e.target.value, value: '' })}
                                            style={inputStyle}
                                        >
                                            <option value="">Field…</option>
                                            {availableFields.map(f => (
                                                <option key={f.field} value={f.field}>{f.label}</option>
                                            ))}
                                        </select>

                                        {addingConstraint.field && (() => {
                                            const def = CONSTRAINT_FIELDS.find(f => f.field === addingConstraint.field);

                                            return def?.options ? (
                                                <select
                                                    value={addingConstraint.value}
                                                    onChange={e => setAddingConstraint(p => ({ ...p, value: e.target.value }))}
                                                    style={inputStyle}
                                                >
                                                    <option value="">Value…</option>
                                                    {def.options.map(o => (
                                                        <option key={o} value={o}>{o}</option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <input
                                                    type="text"
                                                    placeholder="value…"
                                                    value={addingConstraint.value}
                                                    onChange={e => setAddingConstraint(p => ({ ...p, value: e.target.value }))}
                                                    style={{ ...inputStyle, width: 100 }}
                                                />
                                            );
                                        })()}

                                        <button
                                            disabled={!addingConstraint.field || !addingConstraint.value.trim()}
                                            onClick={() => {
                                                setSubgroupConstraints(p => [
                                                    ...p,
                                                    {
                                                        field: addingConstraint.field,
                                                        value: addingConstraint.value.trim()
                                                    }
                                                ]);
                                                setAddingConstraint(null);
                                            }}
                                            style={btnStyle('#27ae60')}
                                        >
                                            Add
                                        </button>

                                        <button onClick={() => setAddingConstraint(null)} style={btnStyle('#888')}>
                                            ✕
                                        </button>
                                    </div>
                                )}

                                {addingConstraint === null && availableFields.length > 0 && (
                                    <button
                                        onClick={() => setAddingConstraint({ field: '', value: '' })}
                                        style={{ ...btnStyle('#555'), fontSize: '0.8rem' }}
                                    >
                                        + Add Grouping Filter
                                    </button>
                                )}

                                <button
                                    onClick={() => setShowSubgroupAvg(v => !v)}
                                    style={btnStyle(showSubgroupAvg ? '#e74c3c' : '#667eea')}
                                >
                                    {showSubgroupAvg ? 'Hide Avg' : 'Show Avg'}
                                </button>
                            </div>
                        );
                    })()}
                </div>

                {/* Row 2 */}
                {(() => {
                    const usedFields = new Set(plotConstraints.map(c => c.field));
                    const availableFields = CONSTRAINT_FIELDS.filter(f => !usedFields.has(f.field));
                    const chipColors = {
                        flag: '#7b6cf6',
                        gender: '#2980b9',
                        genotype: '#27ae60',
                        dob: '#d35400',
                        custom: '#8e44ad'
                    };

                    return (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '4px 16px 6px', borderTop: '1px solid #b0ccd8' }}>
                            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#3a3a6a', whiteSpace: 'nowrap' }}>
                                Filter through Grouping:
                            </label>

                            {plotConstraints.map(({ field, value }) => {
                                const def = CONSTRAINT_FIELDS.find(f => f.field === field);

                                return (
                                    <span
                                        key={field}
                                        style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 4,
                                            background: field.startsWith('custom:')
                                                ? chipColors.custom
                                                : (chipColors[field] || '#555'),
                                            color: '#fff',
                                            borderRadius: 12,
                                            padding: '2px 8px',
                                            fontSize: '0.78rem',
                                            whiteSpace: 'nowrap'
                                        }}
                                    >
                                        {def?.label}: {value}
                                        <span
                                            onClick={() => setPlotConstraints(p => p.filter(c => c.field !== field))}
                                            style={{ cursor: 'pointer', fontWeight: 700, marginLeft: 2 }}
                                        >
                                            ×
                                        </span>
                                    </span>
                                );
                            })}

                            {addingPlotConstraint !== null && (
                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                    <select
                                        autoFocus
                                        value={addingPlotConstraint.field}
                                        onChange={e => setAddingPlotConstraint({ field: e.target.value, value: '' })}
                                        style={inputStyle}
                                    >
                                        <option value="">Field…</option>
                                        {availableFields.map(f => (
                                            <option key={f.field} value={f.field}>{f.label}</option>
                                        ))}
                                    </select>

                                    {addingPlotConstraint.field && (() => {
                                        const def = CONSTRAINT_FIELDS.find(f => f.field === addingPlotConstraint.field);

                                        return def?.options ? (
                                            <select
                                                value={addingPlotConstraint.value}
                                                onChange={e => setAddingPlotConstraint(p => ({ ...p, value: e.target.value }))}
                                                style={inputStyle}
                                            >
                                                <option value="">Value…</option>
                                                {def.options.map(o => (
                                                    <option key={o} value={o}>{o}</option>
                                                ))}
                                            </select>
                                        ) : (
                                            <input
                                                type="text"
                                                placeholder="value…"
                                                value={addingPlotConstraint.value}
                                                onChange={e => setAddingPlotConstraint(p => ({ ...p, value: e.target.value }))}
                                                style={{ ...inputStyle, width: 100 }}
                                            />
                                        );
                                    })()}

                                    <button
                                        disabled={!addingPlotConstraint.field || !addingPlotConstraint.value.trim()}
                                        onClick={() => {
                                            setPlotConstraints(p => [
                                                ...p,
                                                {
                                                    field: addingPlotConstraint.field,
                                                    value: addingPlotConstraint.value.trim()
                                                }
                                            ]);
                                            setAddingPlotConstraint(null);
                                        }}
                                        style={btnStyle('#27ae60')}
                                    >
                                        Add
                                    </button>

                                    <button onClick={() => setAddingPlotConstraint(null)} style={btnStyle('#888')}>
                                        ✕
                                    </button>
                                </div>
                            )}

                            {addingPlotConstraint === null && availableFields.length > 0 && (
                                <button
                                    onClick={() => setAddingPlotConstraint({ field: '', value: '' })}
                                    style={{ ...btnStyle('#555'), fontSize: '0.8rem' }}
                                >
                                    + Add Grouping Filter
                                </button>
                            )}

                            {plotConstraints.length > 0 && (
                                <button
                                    onClick={() => setPlotConstraints([])}
                                    style={{ ...btnStyle('#c0392b'), fontSize: '0.8rem' }}
                                >
                                    Clear All
                                </button>
                            )}
                        </div>
                    );
                })()}
            </div>

            {/* Main area */}
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
                <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                    {allNodes.length === 0 ? (
                        <div style={{ padding: 40, color: '#1a2a3a' }}>
                            No {dataType === 'hematology' ? 'Hemovat' : 'DEXA'} records found.
                        </div>
                    ) : (
                        <>
                            {chartType === 'scatter' && (
                                <div ref={plotRef} style={{ width: '100%', height: '100%' }} />
                            )}

                            {chartType === 'overtime_single' && (
                                <div ref={overtimeSingleRef} style={{ width: '100%', height: '100%' }} />
                            )}

                            {chartType === 'overtime' && (
                                <div ref={overtimeRef} style={{ width: '100%', height: '100%' }} />
                            )}
                        </>
                    )}
                </div>

                {selectedNode && (
                    <div style={{ position: 'absolute', top: 0, right: 0, width: 340, height: '100%', background: '#c5dce8', borderLeft: '2px solid #667eea', overflowY: 'auto', padding: 16, zIndex: 10, boxShadow: '-4px 0 16px rgba(0,0,0,0.12)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                            <strong style={{ color: '#667eea' }}>Subject: {selectedNode.subject_id}</strong>
                            <span
                                onClick={() => setSelectedNode(null)}
                                style={{ cursor: 'pointer', fontSize: '1.2rem', color: '#aaa' }}
                            >
                                ×
                            </span>
                        </div>

                        <div style={{ fontSize: '0.72rem', color: '#555', marginBottom: 8 }}>
                            Click a numeric value to plot over time. Click a value to edit it.
                        </div>

                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                            <tbody>
                                {(() => {
                                    const NON_CHART_CLICKABLE = new Set(['subject_id']);
                                    const NON_EDITABLE = new Set([
                                        'id',
                                        'session_id',
                                        'user_id',
                                        'data_type',
                                        '_measurement_meta'
                                    ]);
                                    const HIDDEN = new Set([
                                        '_nodeId',
                                        '_measurement_meta',
                                        'x',
                                        'y',
                                        'vx',
                                        'vy',
                                        'fx',
                                        'fy',
                                        'index',
                                        'filename',
                                        'id',
                                        'user_id',
                                        'session_id',
                                        ...(dataType === 'hematology' ? ['timepoint'] : [])
                                    ]);
                                    

                                    const DEXA_ORDER = [
                                        'batch',
                                        'subject_id',
                                        'gender',
                                        'timepoint'
                                    ];

                                    const HEMOVAT_ORDER = [
                                        'batch',
                                        'subject_id',
                                        'patient',
                                        'patient_id',
                                        'owner_last_name',
                                        'gender',
                                        'species',
                                        'patient_id',
                                        'mode',
                                        'age',
                                        'delivery_time',
                                        'draw_time',
                                        'time_of_analysis',
                                        'time_of_printing',
                                        'operator',
                                        'veterinarian',
                                        'comments',

                                        // Hemovat measurement fields
                                        'wbc',
                                        'neu_abs',
                                        'lym_abs',
                                        'mon_abs',
                                        'eos_abs',
                                        'bas_abs',
                                        'neu_pct',
                                        'lym_pct',
                                        'mon_pct',
                                        'eos_pct',
                                        'bas_pct',
                                        'rbc',
                                        'hgb',
                                        'hct',
                                        'mcv',
                                        'mch',
                                        'mchc',
                                        'rdw_cv',
                                        'plt',
                                        'mpv'
                                    ];

                                    const ORDER = dataType === 'hematology' ? HEMOVAT_ORDER : DEXA_ORDER;

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

                                        return (
                                            <tr key={k} style={{ borderBottom: '1px solid #ccc' }}>
                                                <td
                                                    style={{
                                                        color: isNumeric ? '#3a5fc8' : '#000',
                                                        padding: '4px 6px',
                                                        width: '45%',
                                                        wordBreak: 'break-all',
                                                        cursor: isNumeric ? 'pointer' : 'default',
                                                        textDecoration: isNumeric ? 'underline dotted' : 'none'
                                                    }}
                                                    onClick={() => {
                                                        if (isNumeric) {
                                                            setModal({
                                                                subject: selectedNode.subject_id,
                                                                variable: k
                                                            });
                                                        }
                                                    }}
                                                >
                                                    {k}
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

                                                                setEditingCell({
                                                                    recordId,
                                                                    field: k
                                                                });

                                                                setEditValue(typeof v === 'number' ? String(v) : String(v ?? ''));
                                                            }}
                                                            style={{
                                                                display: 'block',
                                                                cursor: isEditable ? 'text' : 'default',
                                                                padding: '2px 4px',
                                                                borderRadius: 3,
                                                                minHeight: 20,
                                                                background: isEditable ? 'rgba(255,255,255,0.4)' : 'transparent'
                                                            }}
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
                            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#3a3a6a', marginBottom: 8 }}>
                                Grouping
                            </div>

                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                                <tbody>
                                    <tr style={{ borderBottom: '1px solid #ccc' }}>
                                        <td style={{ padding: '4px 6px', color: '#000', width: '45%' }}>
                                            Flag
                                        </td>
                                        <td style={{ padding: '2px 4px' }}>
                                            <select
                                                value={groupingInput.flag}
                                                onChange={e => setGroupingInput(p => ({ ...p, flag: e.target.value }))}
                                                style={{ ...inputStyle, fontSize: '0.82rem', width: '100%' }}
                                            >
                                                <option value="experiment">Experiment</option>
                                                <option value="control">Control</option>
                                            </select>
                                        </td>
                                    </tr>

                                    <tr style={{ borderBottom: '1px solid #ccc' }}>
                                        <td style={{ padding: '4px 6px', color: '#000' }}>
                                            Gender
                                        </td>
                                        <td style={{ padding: '2px 4px' }}>
                                            <input
                                                value={groupingInput.gender}
                                                onChange={e => setGroupingInput(p => ({ ...p, gender: e.target.value }))}
                                                style={{ ...inputStyle, fontSize: '0.82rem', width: '100%' }}
                                                placeholder="e.g. M / F"
                                            />
                                        </td>
                                    </tr>

                                    <tr style={{ borderBottom: '1px solid #ccc' }}>
                                        <td style={{ padding: '4px 6px', color: '#000' }}>
                                            Date of Birth
                                        </td>
                                        <td style={{ padding: '2px 4px' }}>
                                            <input
                                                value={groupingInput.dob}
                                                onChange={e => setGroupingInput(p => ({ ...p, dob: e.target.value }))}
                                                style={{ ...inputStyle, fontSize: '0.82rem', width: '100%' }}
                                                placeholder="e.g. 2020-01-15"
                                            />
                                        </td>
                                    </tr>

                                    <tr>
                                        <td style={{ padding: '4px 6px', color: '#000' }}>
                                            Genotype
                                        </td>
                                        <td style={{ padding: '2px 4px' }}>
                                            <input
                                                value={groupingInput.genotype}
                                                onChange={e => setGroupingInput(p => ({ ...p, genotype: e.target.value }))}
                                                style={{ ...inputStyle, fontSize: '0.82rem', width: '100%' }}
                                                placeholder="e.g. WT / KO"
                                            />
                                        </td>
                                    </tr>
                                </tbody>
                            </table>

                            <button
                                style={{
                                    ...btnStyle(
                                        groupingSaveStatus === 'error'
                                            ? '#c0392b'
                                            : groupingSaveStatus === 'saved'
                                                ? '#27ae60'
                                                : '#667eea'
                                    ),
                                    marginTop: 10,
                                    width: '100%'
                                }}
                                onClick={async () => {
                                    const subj = selectedNode.subject_id;
                                    const userId = getUserId();

                                    if (!userId) {
                                        console.error('User not authenticated');
                                        return;
                                    }

                                    setGroupingSaveStatus('saving');

                                    try {
                                        const res = await apiFetch(`/api/subject-groupings/${encodeURIComponent(subj)}?user_id=${encodeURIComponent(userId)}`, {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify(groupingInput),
                                        });

                                        const json = await res.json();

                                        if (!res.ok || json.error) {
                                            console.error('Grouping save error:', json.error);
                                            setGroupingSaveStatus('error');
                                        } else {
                                            setGroupings(prev => ({
                                                ...prev,
                                                [subj]: { ...groupingInput }
                                            }));

                                            setGroupingSaveStatus('saved');
                                        }
                                    } catch (e) {
                                        console.error('Grouping save failed:', e);
                                        setGroupingSaveStatus('error');
                                    }

                                    setTimeout(() => setGroupingSaveStatus(null), 2500);
                                }}
                            >
                                {groupingSaveStatus === 'saving'
                                    ? 'Saving…'
                                    : groupingSaveStatus === 'saved'
                                        ? 'Saved ✓'
                                        : groupingSaveStatus === 'error'
                                            ? 'Error — see console'
                                            : 'Save Grouping'}
                            </button>
                        </div>

                        {/* Custom Groupings section */}
                        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #aac' }}>
                            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#3a3a6a', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span>Custom Groupings</span>

                                <button
                                    onClick={() => setShowCustomGroupingPanel(!showCustomGroupingPanel)}
                                    style={{ fontSize: '0.75rem', padding: '2px 6px', background: '#667eea', color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer' }}
                                >
                                    {showCustomGroupingPanel ? '▼' : '▶'} Manage
                                </button>
                            </div>

                            {customGroupings.length > 0 ? (
                                <div style={{ fontSize: '0.8rem', marginBottom: 8, backgroundColor: '#f0f4f9', padding: 8, borderRadius: 4, maxHeight: 120, overflowY: 'auto' }}>
                                    {customGroupings.map(cg => {
                                        const groupingId = String(cg.id);
                                        const isMember = isSubjectInCustomGrouping(selectedNode.subject_id, groupingId);
                                        const isDeleting = deletingGroupingId === groupingId;

                                        return (
                                            <div
                                                key={groupingId}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'space-between',
                                                    gap: 8,
                                                    padding: '4px 4px',
                                                    borderBottom: '1px solid #d8e2ea',
                                                    color: isMember ? '#27ae60' : '#888'
                                                }}
                                            >
                                                <div style={{ minWidth: 0 }}>
                                                    <span>
                                                        {isMember ? '✓ ' : '○ '}
                                                        {cg.name || cg.grouping_name || 'Custom Group'}
                                                    </span>
                                                    <span style={{ fontSize: '0.7rem', color: '#999', marginLeft: 4 }}>
                                                        ({cg.type || cg.grouping_type || 'custom'})
                                                    </span>
                                                </div>

                                                <button
                                                    disabled={isDeleting}
                                                    onClick={() => deleteCustomGrouping(groupingId)}
                                                    style={{
                                                        ...btnStyle(isDeleting ? '#999' : '#c0392b'),
                                                        fontSize: '0.7rem',
                                                        padding: '2px 6px',
                                                        flexShrink: 0
                                                    }}
                                                >
                                                    {isDeleting ? 'Deleting…' : 'Delete'}
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div style={{ fontSize: '0.8rem', color: '#999', marginBottom: 8 }}>
                                    No custom groupings yet
                                </div>
                            )}

                            {showCustomGroupingPanel && (
                                <div style={{ background: '#f9fbfd', border: '1px solid #d0e0e8', borderRadius: 6, padding: 10, marginTop: 8 }}>
                                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#555', marginBottom: 6 }}>
                                        Create New Custom Grouping
                                    </div>

                                    <div style={{ marginBottom: 6 }}>
                                        <label style={{ fontSize: '0.75rem', color: '#555' }}>Name</label>
                                        <input
                                            value={newCustomGrouping.grouping_name}
                                            onChange={e => setNewCustomGrouping(p => ({ ...p, grouping_name: e.target.value }))}
                                            style={{ ...inputStyle, fontSize: '0.8rem', width: '100%', marginTop: 2 }}
                                            placeholder="e.g., High BMD Group"
                                        />
                                    </div>

                                    <div style={{ marginBottom: 6 }}>
                                        <label style={{ fontSize: '0.75rem', color: '#555' }}>Type</label>
                                        <select
                                            value={newCustomGrouping.grouping_type}
                                            onChange={e => setNewCustomGrouping(p => ({ ...p, grouping_type: e.target.value }))}
                                            style={{ ...inputStyle, fontSize: '0.8rem', width: '100%', marginTop: 2 }}
                                        >
                                            <option value="range">Range-Based</option>
                                            <option value="manual_selection">Manual Selection</option>
                                        </select>
                                    </div>

                                    {newCustomGrouping.grouping_type === 'range' && (
                                        <>
                                            <div style={{ marginBottom: 6 }}>
                                                <label style={{ fontSize: '0.75rem', color: '#555' }}>Metric Field</label>
                                                <select
                                                    value={newCustomGrouping.metric_field}
                                                    onChange={e => setNewCustomGrouping(p => ({ ...p, metric_field: e.target.value }))}
                                                    style={{ ...inputStyle, fontSize: '0.8rem', width: '100%', marginTop: 2 }}
                                                >
                                                    <option value="">-- Select field --</option>
                                                    {allMetrics.map(m => (
                                                        <option key={m} value={m}>{m}</option>
                                                    ))}
                                                </select>
                                            </div>

                                            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                                                <div style={{ flex: 1 }}>
                                                    <label style={{ fontSize: '0.75rem', color: '#555' }}>Min</label>
                                                    <input
                                                        type="number"
                                                        value={newCustomGrouping.range_min}
                                                        onChange={e => setNewCustomGrouping(p => ({ ...p, range_min: e.target.value }))}
                                                        style={{ ...inputStyle, fontSize: '0.8rem', width: '100%', marginTop: 2 }}
                                                        placeholder="0.5"
                                                    />
                                                </div>

                                                <div style={{ flex: 1 }}>
                                                    <label style={{ fontSize: '0.75rem', color: '#555' }}>Max</label>
                                                    <input
                                                        type="number"
                                                        value={newCustomGrouping.range_max}
                                                        onChange={e => setNewCustomGrouping(p => ({ ...p, range_max: e.target.value }))}
                                                        style={{ ...inputStyle, fontSize: '0.8rem', width: '100%', marginTop: 2 }}
                                                        placeholder="1.2"
                                                    />
                                                </div>
                                            </div>
                                        </>
                                    )}

                                    {newCustomGrouping.grouping_type === 'manual_selection' && (
                                        <div style={{ marginBottom: 6 }}>
                                            <label style={{ fontSize: '0.75rem', color: '#555' }}>
                                                Subjects (comma-separated)
                                            </label>
                                            <textarea
                                                value={newCustomGrouping.selected_subjects}
                                                onChange={e => {
                                                    setNewCustomGrouping(p => ({
                                                        ...p,
                                                        selected_subjects: e.target.value
                                                    }));
                                                    setCustomGroupingErrorMessage('');

                                                    if (customGroupingStatus === 'subject_not_found') {
                                                        setCustomGroupingStatus(null);
                                                    }
                                                }}
                                                style={{ ...inputStyle, fontSize: '0.8rem', width: '100%', marginTop: 2, minHeight: 60, fontFamily: 'monospace' }}
                                                placeholder="subj001, subj042, subj089"
                                            />
                                        </div>
                                    )}

                                    <button
                                        style={{
                                            ...btnStyle(
                                                customGroupingStatus === 'error' || customGroupingStatus === 'subject_not_found'
                                                    ? '#c0392b'
                                                    : customGroupingStatus === 'saved'
                                                        ? '#27ae60'
                                                        : '#667eea'
                                            ),
                                            width: '100%',
                                            fontSize: '0.8rem'
                                        }}
                                        onClick={async () => {
                                            const userId = getUserId();

                                            if (!userId) {
                                                console.error('User not authenticated');
                                                return;
                                            }

                                            setCustomGroupingStatus('saving');
                                            setCustomGroupingErrorMessage('');

                                            try {
                                                const payload = {
                                                    name: newCustomGrouping.grouping_name,
                                                    grouping_type: newCustomGrouping.grouping_type,
                                                    data_type: dataType,
                                                };

                                                if (newCustomGrouping.grouping_type === 'range') {
                                                    payload.metric_field = newCustomGrouping.metric_field;
                                                    payload.range_min = parseFloat(newCustomGrouping.range_min);
                                                    payload.range_max = parseFloat(newCustomGrouping.range_max);
                                                } else {
                                                    payload.selected_subjects = newCustomGrouping.selected_subjects
                                                        .split(',')
                                                        .map(s => s.trim())
                                                        .filter(s => s.length > 0);
                                                }

                                                const res = await apiFetch(`/api/custom-groupings?user_id=${encodeURIComponent(userId)}`, {
                                                    method: 'POST',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify(payload),
                                                });

                                                const json = await res.json();

                                                if (!res.ok || json.error) {
                                                    console.error('Custom grouping save error:', json.error || json);

                                                    if (json.error === 'subject_not_found') {
                                                        const missing = Array.isArray(json.missing_subjects)
                                                            ? json.missing_subjects.join(', ')
                                                            : '';

                                                        setCustomGroupingStatus('subject_not_found');
                                                        setCustomGroupingErrorMessage(
                                                            missing ? `Subject not found: ${missing}` : 'Subject not found'
                                                        );
                                                    } else {
                                                        setCustomGroupingStatus('error');
                                                        setCustomGroupingErrorMessage(json.error || 'Failed to create grouping');
                                                    }

                                                    return;
                                                }

                                                const listRes = await apiFetch(`/api/custom-groupings?user_id=${encodeURIComponent(userId)}`);
                                                const listData = await listRes.json();

                                                const filteredCustomGroupings = Array.isArray(listData)
                                                    ? listData.filter(cg => {
                                                        const cgType = cg.data_type === 'hemovat'
                                                            ? 'hematology'
                                                            : (cg.data_type || 'dexa');

                                                        return cgType === dataType;
                                                    })
                                                    : [];

                                                setCustomGroupings(filteredCustomGroupings);

                                                const newId = json.grouping.id;

                                                const membersRes = await apiFetch(`/api/custom-groupings/${encodeURIComponent(newId)}/members?user_id=${encodeURIComponent(userId)}`);
                                                const membersData = await membersRes.json();

                                                if (membersData.subjects) {
                                                    setCustomGroupingMembers(prev => ({
                                                        ...prev,
                                                        [String(newId)]: membersData.subjects.map(s => String(s).trim())
                                                    }));
                                                }

                                                setNewCustomGrouping({
                                                    grouping_name: '',
                                                    grouping_type: 'range',
                                                    metric_field: '',
                                                    range_min: '',
                                                    range_max: '',
                                                    selected_subjects: ''
                                                });

                                                setCustomGroupingStatus('saved');
                                                setTimeout(() => setCustomGroupingStatus(null), 2500);
                                            } catch (e) {
                                                console.error('Custom grouping save failed:', e);
                                                setCustomGroupingStatus('error');
                                                setCustomGroupingErrorMessage('Failed to create grouping');
                                            }
                                        }}
                                    >
                                        {customGroupingStatus === 'saving'
                                            ? 'Creating…'
                                            : customGroupingStatus === 'saved'
                                                ? 'Created ✓'
                                                : customGroupingStatus === 'subject_not_found'
                                                    ? 'Subject not found'
                                                    : customGroupingStatus === 'error'
                                                        ? 'Error'
                                                        : 'Create Grouping'}
                                    </button>

                                    {customGroupingErrorMessage && (
                                        <div style={{ color: '#c0392b', fontSize: '0.75rem', marginTop: 6 }}>
                                            {customGroupingErrorMessage}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {modal && (
                    <div
                        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        onClick={() => setModal(null)}
                    >
                        <div
                            style={{ background: '#eaf4fb', borderRadius: 10, padding: 20, width: 640, maxWidth: '90vw', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}
                            onClick={e => e.stopPropagation()}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                                <strong style={{ color: '#1a2a3a' }}>
                                    {modal.variable} over time — {modal.subject}
                                </strong>
                                <span
                                    onClick={() => setModal(null)}
                                    style={{ cursor: 'pointer', fontSize: '1.4rem', color: '#aaa', lineHeight: 1 }}
                                >
                                    ×
                                </span>
                            </div>

                            <div ref={modalPlotRef} style={{ width: '100%', height: 340 }} />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

const btnStyle = bg => ({
    padding: '4px 12px',
    borderRadius: 4,
    border: 'none',
    background: bg,
    color: '#fff',
    cursor: 'pointer',
    fontSize: '0.85rem'
});

const inputStyle = {
    padding: '4px 8px',
    borderRadius: 4,
    border: '1px solid #555',
    background: '#fff',
    color: '#1a2a3a',
    fontSize: '0.85rem'
};
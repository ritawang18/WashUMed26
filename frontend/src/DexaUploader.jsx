import { useState } from 'react';
import { supabase } from './auth/supabaseClient';
import './DexaUploader.css';

const DexaUploader = ({ session, onVisualize, onUploadComplete }) => {
    const [uploadMode, setUploadMode] = useState('dexa'); // 'dexa' | 'hematology'
    const [files, setFiles] = useState([]);
    const [processing, setProcessing] = useState(false);
    const [result, setResult] = useState(null);
    const [dragActive, setDragActive] = useState(false);
    const [editableRecords, setEditableRecords] = useState([]);
    const [parsedUploadMeta, setParsedUploadMeta] = useState(null);
    const [savingParsedResult, setSavingParsedResult] = useState(false);
    const [saveStatus, setSaveStatus] = useState(null);


    const HEMOVAT_REVIEW_COLUMNS = [
        'Patient',
        'Owner Last Name',
        'Gender',
        'Sample ID',
        'Species',
        'Patient ID',
        'Mode',
        'Age',
        'Parameter',
        'Result',
        'Unit',
        'Ref. Ranges',
        'Delivery Time',
        'Draw Time',
        'Time of Analysis',
        'Time of Printing',
        'Operator',
        'Veterinarian',
        'Comments',
    ];

    const modeConfig = {
        dexa: {
            label: 'DEXA Scan',
            icon: '🦴',
            accept: '.txt,.csv,.xlsx,.xls',
            hint: 'Supports .txt, .csv, .xlsx files from DEXA scan batches',
            title: 'DEXA Data Cleaner & Unifier',
            subtitle: 'Upload your raw DEXA scan files to get a standardized, unified dataset',
            btnLabel: 'Clean & Standardize DEXA Data',
        },
        hematology: {
            label: 'Hematology / CBC',
            icon: '🩸',
            accept: '.pdf',
            hint: 'Upload PDF lab reports (CBC, hematology panels)',
            title: 'Hematology Lab Report Extractor',
            subtitle: 'Upload CBC / blood panel PDFs — Gemini AI will extract and tabulate the results',
            btnLabel: 'Extract Lab Report Data',
        },
    };

    const mode = modeConfig[uploadMode];

    const handleModeSwitch = (m) => {
        setUploadMode(m);
        setFiles([]);
        setResult(null);
        setEditableRecords([]);
    };

    const handleFileUpload = (event) => {
        setFiles(Array.from(event.target.files));
    };

    const handleDrag = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
        else if (e.type === "dragleave") setDragActive(false);
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        if (e.dataTransfer.files?.[0]) setFiles(Array.from(e.dataTransfer.files));
    };

    const processFiles = async () => {
        if (files.length === 0) return;

        if (!session?.user?.id) {
            setResult({ error: 'User session not found' });
            return;
        }

        setProcessing(true);
        setSaveStatus?.(null);

        const formData = new FormData();
        files.forEach(file => formData.append('files', file));
        formData.append('upload_mode', uploadMode);
        formData.append('user_id', session.user.id);

        const endpoint = uploadMode === 'hematology'
            ? '/api/hematology/parse'
            : '/api/dexa/process';

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'X-User-Id': session.user.id,
                },
                body: formData,
            });

            const data = await response.json();

            if (!response.ok || data.error) {
                throw new Error(data.error || 'Processing failed');
            }

            console.log('Process response:', data);
            setResult(data);

            if (data.records) {
                setEditableRecords(data.records);
            }

            // DEXA is saved immediately by backend.
            // Hemovat is only parsed here; user saves it separately.
            if (data.status === 'success' && uploadMode === 'dexa') {
                onUploadComplete?.(data);
            }
        } catch (error) {
            console.error('Upload failed:', error);
            setResult({ error: error.message });
        } finally {
            setProcessing(false);
        }
    };

    const resetUploader = () => {
        setFiles([]);
        setResult(null);
        setEditableRecords([]);
        setParsedUploadMeta(null);
        setSaveStatus(null);
    };

    const handleCellEdit = (rowIdx, col, value) => {
        setEditableRecords(prev =>
            prev.map((r, i) => i === rowIdx ? { ...r, [col]: value } : r)
        );
    };

    const saveHemovatParsingResult = async () => {
        if (!session?.user?.id) {
            setSaveStatus({ type: 'error', message: 'User session not found' });
            return;
        }

        if (!editableRecords.length) {
            setSaveStatus({ type: 'error', message: 'No parsed rows to save' });
            return;
        }

        setSavingParsedResult(true);
        setSaveStatus(null);

        try {
            const response = await fetch('/api/hematology-reports/save', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-Id': session.user.id,
                },
                body: JSON.stringify({
                    user_id: session.user.id,
                    filename: parsedUploadMeta?.filename || files[0]?.name || '',
                    batch: parsedUploadMeta?.batch || 'Unknown_Batch',
                    records: editableRecords,
                }),
            });

            const data = await response.json();

            if (!response.ok || data.error) {
                throw new Error(data.error || 'Failed to save Hemovat parsing result');
            }

            setSaveStatus({
                type: 'success',
                message: 'Hemovat parsing result saved successfully.',
            });

            onUploadComplete?.(data);
        } catch (err) {
            console.error('Save Hemovat parsing result failed:', err);
            setSaveStatus({
                type: 'error',
                message: err.message,
            });
        } finally {
            setSavingParsedResult(false);
        }
    };

    const downloadEditedCsv = () => {
        if (editableRecords.length === 0) return;
        const cols = Object.keys(editableRecords[0]);
        const escape = v => {
            const s = v === null || v === undefined ? '' : String(v);
            return s.includes(',') || s.includes('"') || s.includes('\n')
                ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const csv = [cols.join(','), ...editableRecords.map(r => cols.map(c => escape(r[c])).join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = result?.csv_filename || 'data.csv';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
    };

    const goToVisualization = (csvUrlOrFilename) => {
        if (!csvUrlOrFilename) return;
        const filename = csvUrlOrFilename.includes('/') ? csvUrlOrFilename.split('/').pop() : csvUrlOrFilename;
        onVisualize(filename);
    };

    const columns = editableRecords.length > 0
        ? (uploadMode === 'hematology' ? HEMOVAT_REVIEW_COLUMNS : Object.keys(editableRecords[0]))
        : [];

    return (
        <div className="dexa-uploader">
            {/* Mode toggle */}
            <div className="upload-mode-toggle">
                {Object.entries(modeConfig).map(([key, cfg]) => (
                    <button
                        key={key}
                        className={`mode-tab ${uploadMode === key ? 'active' : ''}`}
                        onClick={() => handleModeSwitch(key)}
                    >
                        {cfg.icon} {cfg.label}
                    </button>
                ))}
            </div>

            <div className="uploader-header">
                <h2>{mode.title}</h2>
                <p>{mode.subtitle}</p>
            </div>

            {!result && (
                <>
                    <div
                        className={`upload-area ${dragActive ? 'drag-active' : ''}`}
                        onDragEnter={handleDrag}
                        onDragLeave={handleDrag}
                        onDragOver={handleDrag}
                        onDrop={handleDrop}
                    >
                        <input
                            type="file"
                            id="file-upload"
                            multiple
                            accept={mode.accept}
                            onChange={handleFileUpload}
                            className="file-input"
                        />
                        <label htmlFor="file-upload" className="upload-label">
                            <div className="upload-icon">{mode.icon}</div>
                            <div className="upload-text">
                                <strong>Click to upload</strong> or drag and drop
                                <br />
                                <small>{mode.hint}</small>
                            </div>
                        </label>
                    </div>

                    {files.length > 0 && (
                        <div className="file-list">
                            <h3>Selected Files ({files.length})</h3>
                            <div className="files">
                                {files.map((file, index) => (
                                    <div key={index} className="file-item">
                                        <span className="file-name">{file.name}</span>
                                        <span className="file-size">{(file.size / 1024).toFixed(1)} KB</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="action-area">
                        <button onClick={processFiles} disabled={files.length === 0 || processing} className="process-btn">
                            {processing ? (<><div className="spinner"></div>Processing...</>) : mode.btnLabel}
                        </button>
                        {files.length > 0 && (
                            <button onClick={resetUploader} className="reset-btn">Clear Files</button>
                        )}
                    </div>
                </>
            )}

            {result && (
                <div className="results-section">
                    {result.error ? (
                        <div className="error-result">
                            <h3>❌ Processing Failed</h3>
                            <p>{result.error}</p>
                            <button onClick={resetUploader} className="retry-btn">Try Again</button>
                        </div>
                    ) : (
                        <div className="success-result">
                            <h3>✅ Processing Complete!</h3>

                            <div className="result-stats">
                                <div className="stat">
                                    <strong>{result.total_records}</strong>
                                    <span>Total Records</span>
                                </div>
                                <div className="stat">
                                    <strong>{Array.isArray(result.batches_processed) ? result.batches_processed.length : result.batches_processed}</strong>
                                    <span>Batches</span>
                                </div>
                                <div className="stat">
                                    <strong>{result.duplicates_removed || 0}</strong>
                                    <span>Duplicates Removed</span>
                                </div>
                                <div className="stat">
                                    <strong>{result.images_linked || 0}</strong>
                                    <span>Images Linked</span>
                                </div>
                            </div>

                            {editableRecords.length > 0 && (
                                <div className="editable-table-section">
                                    <div className="editable-table-header">
                                        <h4>📝 Review & Edit Results</h4>
                                        <small>
                                            {uploadMode === 'hematology'
                                                ? 'Click any cell to edit, then click Save Parsing Result to save to the database.'
                                                : 'Click any cell to edit. Changes apply to the downloaded CSV.'}
                                        </small>
                                    </div>
                                    <div className="editable-table-wrapper">
                                        <table className="editable-table">
                                            <thead>
                                                <tr>
                                                    {columns.map(col => <th key={col}>{col}</th>)}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {editableRecords.map((row, rowIdx) => (
                                                    <tr key={rowIdx}>
                                                        {columns.map(col => (
                                                            <td key={col}>
                                                                <input
                                                                    value={row[col] === null || row[col] === undefined ? '' : row[col]}
                                                                    onChange={e => handleCellEdit(rowIdx, col, e.target.value)}
                                                                    className="cell-input"
                                                                />
                                                            </td>
                                                        ))}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            <div className="download-section">
                                <button onClick={downloadEditedCsv} className="download-btn primary">
                                    📊 Download CSV Dataset
                                </button>

                                {uploadMode === 'hematology' && (
                                    <button
                                        onClick={saveHemovatParsingResult}
                                        disabled={savingParsedResult}
                                        className="download-btn visualization"
                                    >
                                        {savingParsedResult ? 'Saving…' : '💾 Save Parsing Result'}
                                    </button>
                                )}

                                {result.excel_download_url && uploadMode === 'dexa' && (
                                    <a
                                        href={result.excel_download_url}
                                        download="unified_dexa_analysis.xlsx"
                                        className="download-btn secondary"
                                    >
                                        📈 Download Excel Analysis
                                    </a>
                                )}

                                {result.csv_download_url && uploadMode === 'dexa' && (
                                    <button
                                        onClick={() => goToVisualization(result.csv_download_url)}
                                        className="download-btn visualization"
                                    >
                                        📊 View Interactive Visualization
                                    </button>
                                )}
                            </div>

                            {saveStatus && (
                                <div
                                    style={{
                                        marginTop: 12,
                                        color: saveStatus.type === 'success' ? '#27ae60' : '#c0392b',
                                        fontWeight: 600,
                                    }}
                                >
                                    {saveStatus.message}
                                </div>
                            )}

                            <button onClick={resetUploader} className="new-upload-btn">Process New Files</button>
                        </div>
                    )}
                </div>
            )}

            {/* Format preview — only shown in DEXA mode */}
            {uploadMode === 'dexa' && (
                <div className="format-preview">
                    <h4>📋 Output Format</h4>
                    <p>Your files will be standardized to this format:</p>
                    <div className="preview-table">
                        <table>
                            <thead>
                                <tr>
                                    <th>batch</th><th>subject_id</th><th>timepoint_standardized</th>
                                    <th>gender</th><th>total_weight</th><th>bmd</th><th>fat_percent</th><th>image_path</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td>Batch_1</td><td>B1_M_1</td><td>Baseline</td>
                                    <td>Male</td><td>33.61</td><td>80.06</td><td>25.97</td><td>/path/to/image.jpg</td>
                                </tr>
                                <tr>
                                    <td>Batch_2</td><td>B2_F_3</td><td>Week_1</td>
                                    <td>Female</td><td>28.45</td><td>75.23</td><td>22.14</td><td>/path/to/image.bmp</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <div className="feature-list">
                        <h5>✨ Features:</h5>
                        <ul>
                            <li>Standardized timepoint names (Week_0/Pre_Scan → Baseline)</li>
                            <li>Automatic duplicate removal</li>
                            <li>Image metadata integration</li>
                            <li>Multi-sheet Excel export with summaries</li>
                            <li>Consistent column ordering across batches</li>
                        </ul>
                    </div>
                </div>
            )}

            {uploadMode === 'hematology' && (
                <div className="format-preview">
                    <h4>📋 Output Format</h4>
                    <p>Each Hemovat PDF is parsed into editable rows, then saved as one hematology report with measurements stored as JSON.</p>
                    <div className="preview-table">
                        <table>
                            <thead>
                                <tr>
                                    <th>Patient</th>
                                    <th>Sample ID</th>
                                    <th>Parameter</th>
                                    <th>Result</th>
                                    <th>Unit</th>
                                    <th>Ref. Ranges</th>
                                    <th>Time of Analysis</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td>4239</td><td>2025-01-14</td><td>WBC</td>
                                    <td></td><td>6.5</td><td>K/uL</td><td>4.0–11.0</td>
                                </tr>
                                <tr>
                                    <td>4239</td><td>2025-01-14</td><td>HGB</td>
                                    <td>H</td><td>15.2</td><td>g/dL</td><td>11.5–14.5</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <div className="feature-list">
                        <h5>✨ Features:</h5>
                        <ul>
                            <li>Gemini AI extracts tables from scanned PDFs</li>
                            <li>Subject ID pulled from PDF content (not filename)</li>
                            <li>High/Low flags preserved</li>
                            <li>Review and edit parsed values before saving</li>
                            <li>Saved as one row in hematology_reports with measurements JSONB</li>
                        </ul>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DexaUploader;

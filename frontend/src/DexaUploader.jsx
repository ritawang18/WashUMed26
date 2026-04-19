import { useState } from 'react';
import { supabase } from './auth/supabaseClient';
import './DexaUploader.css';

const DexaUploader = ({ session, onVisualize }) => {
    const [files, setFiles] = useState([]);
    const [processing, setProcessing] = useState(false);
    const [result, setResult] = useState(null);
    const [dragActive, setDragActive] = useState(false);
    const [editableRecords, setEditableRecords] = useState([]);

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
        setProcessing(true);
        const formData = new FormData();
        files.forEach(file => formData.append('files', file));

        try {
            const response = await fetch('/api/process-dexa', { method: 'POST', body: formData });
            if (!response.ok) throw new Error('Processing failed');
            const data = await response.json();
            console.log('Process response:', data);
            setResult(data);
            if (data.records) setEditableRecords(data.records);
            if (data.status === 'success') await saveToSupabase(data);
        } catch (error) {
            console.error('Upload failed:', error);
            setResult({ error: error.message });
        } finally {
            setProcessing(false);
        }
    };

    const saveToSupabase = async (data) => {
        if (!session?.user?.id) return;
        try {
            const insertPayload = {
                user_id: session.user.id,
                status: 'success',
                files_uploaded: data.files_uploaded,
                files_processed: data.files_processed,
                total_records: data.total_records,
                duplicates_removed: data.duplicates_removed,
                imputation_strategy: data.imputation_strategy,
                batches_processed: data.batches_processed,
                timepoints_found: data.timepoints_found,
                processing_warnings: data.processing_warnings || null,
            };
            if (data.session_id) insertPayload.session_id = data.session_id;
            const { error } = await supabase.from('upload_sessions').insert(insertPayload).select('session_id').single();
            if (error) throw error;
        } catch (err) {
            console.error('Supabase save failed:', err.message);
        }
    };

    const resetUploader = () => {
        setFiles([]);
        setResult(null);
        setEditableRecords([]);
    };

    // Edit a single cell in the editable table
    const handleCellEdit = (rowIdx, col, value) => {
        setEditableRecords(prev => {
            const next = prev.map((r, i) => i === rowIdx ? { ...r, [col]: value } : r);
            return next;
        });
    };

    // Download current (possibly edited) records as CSV
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

    const columns = editableRecords.length > 0 ? Object.keys(editableRecords[0]) : [];

    return (
        <div className="dexa-uploader">
            <div className="uploader-header">
                <h2>DEXA Data Cleaner & Unifier</h2>
                <p>Upload your raw DEXA files to get a standardized, unified dataset</p>
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
                            accept=".txt,.csv,.xlsx,.xls,.pdf,.png,.jpg,.jpeg,.tif,.bmp,.img,.pxl"
                            onChange={handleFileUpload}
                            className="file-input"
                        />
                        <label htmlFor="file-upload" className="upload-label">
                            <div className="upload-icon">📁</div>
                            <div className="upload-text">
                                <strong>Click to upload</strong> or drag and drop
                                <br />
                                <small>Supports .txt, .csv, .xlsx, and .pdf files from DEXA batches</small>
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
                            {processing ? (<><div className="spinner"></div>Processing DEXA Data...</>) : 'Clean & Standardize Data'}
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

                            {/* Editable Table */}
                            {editableRecords.length > 0 && (
                                <div className="editable-table-section">
                                    <div className="editable-table-header">
                                        <h4>📝 Review & Edit Results</h4>
                                        <small>Click any cell to edit. Changes apply to the downloaded CSV.</small>
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

                                {result.excel_download_url && (
                                    <a href={result.excel_download_url} download="unified_dexa_analysis.xlsx" className="download-btn secondary">
                                        📈 Download Excel Analysis
                                    </a>
                                )}

                                {result.csv_download_url && (
                                    <button onClick={() => goToVisualization(result.csv_download_url)} className="download-btn visualization">
                                        📊 View Interactive Visualization
                                    </button>
                                )}
                            </div>

                            <button onClick={resetUploader} className="new-upload-btn">Process New Files</button>
                        </div>
                    )}
                </div>
            )}

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
        </div>
    );
};

export default DexaUploader;

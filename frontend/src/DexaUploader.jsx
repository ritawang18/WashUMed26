import React, { useState } from 'react';
import { supabase } from './auth/supabaseClient';
import './DexaUploader.css';

const DexaUploader = ({ session }) => {
    const [files, setFiles] = useState([]);
    const [processing, setProcessing] = useState(false);
    const [result, setResult] = useState(null);
    const [dragActive, setDragActive] = useState(false);

    // Handle file selection
    const handleFileUpload = (event) => {
        const selectedFiles = Array.from(event.target.files);
        setFiles(selectedFiles);
    };

    // Handle drag and drop
    const handleDrag = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "dragenter" || e.type === "dragover") {
            setDragActive(true);
        } else if (e.type === "dragleave") {
            setDragActive(false);
        }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            const droppedFiles = Array.from(e.dataTransfer.files);
            setFiles(droppedFiles);
        }
    };

    // Process files using your unified format logic
    const processFiles = async () => {
        if (files.length === 0) return;
        
        setProcessing(true);
        
        const formData = new FormData();
        files.forEach(file => {
            formData.append('files', file);
        });

        try {
            // Using our own API implementation
            const response = await fetch('/api/process-dexa', {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                throw new Error('Processing failed');
            }
            
            const data = await response.json();
            console.log('Process response:', data);
            setResult(data);
            if (data.status === 'success') {
                await saveToSupabase(data);
            }
        } catch (error) {
            console.error('Upload failed:', error);
            setResult({ error: error.message });
        } finally {
            setProcessing(false);
        }
    };

    const saveToSupabase = async (data) => {
        if (!session?.user?.id) return;
        const userId = session.user.id;

        try {
            // Insert the upload session row
            const { data: sessionRow, error: sessionError } = await supabase
                .from('upload_sessions')
                .insert({
                    user_id: userId,
                    status: 'success',
                    files_uploaded: data.files_uploaded,
                    files_processed: data.files_processed,
                    total_records: data.total_records,
                    duplicates_removed: data.duplicates_removed,
                    imputation_strategy: data.imputation_strategy,
                    batches_processed: data.batches_processed,
                    timepoints_found: data.timepoints_found,
                    csv_filename: data.csv_filename,
                    processing_warnings: data.processing_warnings || null,
                })
                .select('id')
                .single();

            if (sessionError) throw sessionError;
            const sessionId = sessionRow.id;

            // Insert individual DEXA records in chunks of 100
            if (data.records && data.records.length > 0) {
                const recordsWithIds = data.records.map(r => ({
                    ...r,
                    session_id: sessionId,
                    user_id: userId,
                }));
                const chunkSize = 100;
                for (let i = 0; i < recordsWithIds.length; i += chunkSize) {
                    const chunk = recordsWithIds.slice(i, i + chunkSize);
                    const { error: recordsError } = await supabase
                        .from('dexa_records')
                        .insert(chunk);
                    if (recordsError) throw recordsError;
                }
            }

            console.log('Session saved to Supabase:', sessionId);
        } catch (err) {
            console.error('Supabase save failed (processing result still available):', err.message);
        }
    };

    const resetUploader = () => {
        setFiles([]);
        setResult(null);
    };

        const goToVisualization = (csvUrlOrFilename) => {
            // Accept either full URL or filename
            if (!csvUrlOrFilename) return;
            const filename = csvUrlOrFilename.includes('/') ? csvUrlOrFilename.split('/').pop() : csvUrlOrFilename;
            window.location.href = `/visualization.html?file=${filename}`;
        };

    return (
        <div className="dexa-uploader">
            <div className="uploader-header">
                <h2>DEXA Data Cleaner & Unifier</h2>
                <p>Upload your raw DEXA files to get a standardized, unified dataset</p>
            </div>

            {!result && (
                <>
                    {/* File Upload Area */}
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
                            accept=".txt,.csv,.xlsx,.xls,.png,.jpg,.jpeg,.tif,.bmp,.img,.pxl" 
                            onChange={handleFileUpload}
                            className="file-input"
                        />
                        <label htmlFor="file-upload" className="upload-label">
                            <div className="upload-icon">📁</div>
                            <div className="upload-text">
                                <strong>Click to upload</strong> or drag and drop
                                <br />
                                <small>Supports .txt and .csv files from DEXA batches</small>
                            </div>
                        </label>
                    </div>

                    {/* File List */}
                    {files.length > 0 && (
                        <div className="file-list">
                            <h3>Selected Files ({files.length})</h3>
                            <div className="files">
                                {files.map((file, index) => (
                                    <div key={index} className="file-item">
                                        <span className="file-name">{file.name}</span>
                                        <span className="file-size">
                                            {(file.size / 1024).toFixed(1)} KB
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Process Button */}
                    <div className="action-area">
                        <button 
                            onClick={processFiles} 
                            disabled={files.length === 0 || processing}
                            className="process-btn"
                        >
                            {processing ? (
                                <>
                                    <div className="spinner"></div>
                                    Processing DEXA Data...
                                </>
                            ) : (
                                'Clean & Standardize Data'
                            )}
                        </button>
                        
                        {files.length > 0 && (
                            <button onClick={resetUploader} className="reset-btn">
                                Clear Files
                            </button>
                        )}
                    </div>
                </>
            )}

            {/* Results Section */}
            {result && (
                <div className="results-section">
                    {result.error ? (
                        <div className="error-result">
                            <h3>❌ Processing Failed</h3>
                            <p>{result.error}</p>
                            <button onClick={resetUploader} className="retry-btn">
                                Try Again
                            </button>
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

                            <div className="download-section">
                                <a 
                                    href={result.csv_download_url} 
                                    download="unified_dexa_cleaned.csv"
                                    className="download-btn primary"
                                >
                                    📊 Download CSV Dataset
                                </a>
                                
                                {result.excel_download_url && (
                                    <a 
                                        href={result.excel_download_url} 
                                        download="unified_dexa_analysis.xlsx"
                                        className="download-btn secondary"
                                    >
                                        📈 Download Excel Analysis
                                    </a>
                                )}

                                {/* Show visualization button when CSV URL is available */}
                                {result.csv_download_url && (
                                    <button
                                        onClick={() => goToVisualization(result.csv_download_url)}
                                        className="download-btn visualization"
                                    >
                                        📊 View Interactive Visualization
                                    </button>
                                )}
                            </div>

                            <button onClick={resetUploader} className="new-upload-btn">
                                Process New Files
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Format Preview */}
            <div className="format-preview">
                <h4>📋 Output Format</h4>
                <p>Your files will be standardized to this format:</p>
                <div className="preview-table">
                    <table>
                        <thead>
                            <tr>
                                <th>batch</th>
                                <th>subject_id</th>
                                <th>timepoint_standardized</th>
                                <th>gender</th>
                                <th>total_weight</th>
                                <th>bmd</th>
                                <th>fat_percent</th>
                                <th>image_path</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>Batch_1</td>
                                <td>B1_M_1</td>
                                <td>Baseline</td>
                                <td>Male</td>
                                <td>33.61</td>
                                <td>80.06</td>
                                <td>25.97</td>
                                <td>/path/to/image.jpg</td>
                            </tr>
                            <tr>
                                <td>Batch_2</td>
                                <td>B2_F_3</td>
                                <td>Week_1</td>
                                <td>Female</td>
                                <td>28.45</td>
                                <td>75.23</td>
                                <td>22.14</td>
                                <td>/path/to/image.bmp</td>
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

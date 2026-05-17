import { useEffect, useState } from 'react';
import { supabase } from '../auth/supabaseClient';
import './CasesCanvas.css';

const CasesCanvas = ({ session, refreshKey }) => {
    const [loading, setLoading] = useState(true);
    const [sessions, setSessions] = useState([]);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchSessions = async () => {
            if (!session?.user?.id) return;

            setLoading(true);
            setError(null);

            try {
                const res = await fetch(`/api/cases?user_id=${encodeURIComponent(session.user.id)}`, {
                    headers: {
                        'X-User-Id': session.user.id,
                    },
                });

                const data = await res.json();

                if (!res.ok || data.error) {
                    throw new Error(data.error || 'Failed to load cases');
                }

                setSessions(Array.isArray(data) ? data : []);
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchSessions();
    }, [session?.user?.id, refreshKey]);

    if (loading) {
        return (
            <div className="cases-canvas">
                <div className="cases-loading">
                    <div className="spinner"></div>
                    <p>Loading cases…</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="cases-canvas">
                <div className="cases-error">
                    <p>Failed to load cases: {error}</p>
                </div>
            </div>
        );
    }

    if (sessions.length === 0) {
        return (
            <div className="cases-canvas">
                <div className="empty-state">
                    <div className="empty-icon">📂</div>
                    <p>No cases yet — upload your first files!</p>
                </div>
            </div>
        );
    }

    return (
        <div className="cases-canvas">
            <div className="cases-header">
                <h2>My Cases</h2>
                <p>{sessions.length} upload session{sessions.length !== 1 ? 's' : ''}</p>
            </div>
            <div className="cases-list">
                {sessions.map((s) => (
                    <SessionCard key={s.session_id} session={s} />
                ))}
            </div>
        </div>
    );
};

const SessionCard = ({ session: s }) => {
    const date = new Date(s.created_at).toLocaleString();

    const normalizeList = (value) => {
        if (Array.isArray(value)) {
            return value.filter(Boolean).join(', ') || '—';
        }

        if (typeof value === 'string') {
            try {
                const parsed = JSON.parse(value);
                if (Array.isArray(parsed)) {
                    return parsed.filter(Boolean).join(', ') || '—';
                }
            } catch {
                return value || '—';
            }
        }

        return value || '—';
    };

    const batches = normalizeList(s.batches_processed);
    const timepoints = normalizeList(s.timepoints_found);
    const warningCount = Array.isArray(s.processing_warnings)
        ? s.processing_warnings.length
        : (s.processing_warnings ? 1 : 0);

    return (
        <div className="case-card">
            <div className="case-card-header">
                <span className="case-date">{date}</span>
                {s.session_id && (
                    <a
                        href={`http://localhost:5001/api/export-csv/${s.session_id}?user_id=${encodeURIComponent(s.user_id)}`}
                        className="download-chip"
                        download
                    >
                        ⬇ Download CSV
                    </a>
                )}
            </div>

            <div className="case-stats">
                <span className="stat-chip">
                    <strong>{s.total_records ?? '—'}</strong> records
                </span>
                <span className="stat-chip">
                    <strong>{s.files_processed ?? '—'}</strong> / {s.files_uploaded ?? '—'} files
                </span>
                <span className="stat-chip">
                    <strong>{s.duplicates_removed ?? 0}</strong> duplicates removed
                </span>
            </div>

            <div className="case-details">
                <div className="case-detail-row">
                    <span className="detail-label">Batches</span>
                    <span className="detail-value">{batches}</span>
                </div>
                <div className="case-detail-row">
                    <span className="detail-label">Timepoints</span>
                    <span className="detail-value">{timepoints}</span>
                </div>
            </div>

            {warningCount > 0 && (
                <details className="case-warnings">
                    <summary>{warningCount} warning{warningCount !== 1 ? 's' : ''}</summary>
                    <ul>
                        {(Array.isArray(s.processing_warnings) ? s.processing_warnings : [s.processing_warnings]).map((w, i) => (
                            <li key={i}>{w}</li>
                        ))}
                    </ul>
                </details>
            )}
        </div>
    );
};

export default CasesCanvas;

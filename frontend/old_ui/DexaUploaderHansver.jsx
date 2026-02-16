import React, { useState, useRef } from 'react'

export default function DexaUploader({ apiUrl = '/api/process-dexa' }) {
  const [status, setStatus] = useState(null)
  const [result, setResult] = useState(null)
  const fileRef = useRef()

  async function handleSubmit(e) {
    e.preventDefault()
    const file = fileRef.current && fileRef.current.files && fileRef.current.files[0]
    if (!file) {
      setStatus('Please select a file')
      return
    }
    const fd = new FormData()
    fd.append('file', file)
    setStatus('Uploading...')
    setResult(null)
    try {
      const res = await fetch(apiUrl, { method: 'POST', body: fd })
      const json = await res.json()
      setResult(json)
      setStatus(res.ok ? 'Upload complete' : `Server returned ${res.status}`)
    } catch (err) {
      setStatus('Network error')
      setResult({ error: String(err) })
    }
  }

  return (
    <div className="dexa-uploader">
      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="dexa-file">Select DEXA / CSV file:</label>
        </div>
        <div>
          <input id="dexa-file" type="file" ref={fileRef} accept=".csv,.txt" />
        </div>
        <div style={{ marginTop: 8 }}>
          <button type="submit">Upload</button>
        </div>
      </form>

      {status && (
        <div style={{ marginTop: 12 }}>
          <strong>Status:</strong> {status}
        </div>
      )}

      {result && (
        <div style={{ marginTop: 12 }}>
          <strong>Result</strong>
          <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto' }}>
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}
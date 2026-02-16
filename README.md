# Enhanced DEXA Data Processing System

## Overview
Complete web-based DEXA data processing system with beautiful teal interface, advanced data cleaning, and comprehensive standardization capabilities.

## ✨ Features

### 🎨 Beautiful Teal Interface
- **Simplified Upload**: Clean 3-step workflow (Upload → Process → Download)
- **Drag & Drop**: Intuitive file upload with visual feedback
- **Glassmorphism Design**: Modern teal gradient with elegant styling
- **Responsive Layout**: Works on desktop and mobile devices

### 🔧 Enhanced Backend Processing
- **Multi-File Support**: Process up to 50 files simultaneously
- **Smart Data Cleaning**: Advanced test detection and duplicate removal
- **Intelligent Imputation**: Multiple strategies for missing data
- **Statistical Validation**: Outlier detection with IQR methods
- **Batch Standardization**: Unified naming across all data sources

### 📊 Supported File Types
- **Text/CSV**: `.txt`, `.csv` files
- **Excel**: `.xlsx`, `.xls` files  
- **PDF**: `.pdf` documents with table extraction
- **Images**: `.tif`, `.png`, `.jpeg`, `.bmp` DEXA scans

## 🚀 Quick Start

### Prerequisites
- Python 3.9+ (or compatible 3.x)
- Node.js 16+ and npm

### One-command start

```bash
pip install -r backend/requirements.txt   # first time only
npm install                                # first time only
npm start
```

This single `npm start` will:
1. Auto-install frontend dependencies
2. Start the Flask backend on `http://localhost:5001`
3. Start the React frontend on `http://localhost:3000`

Open **http://localhost:3000** to use the app. API requests are automatically proxied to the backend.

### Production / Static Hosting
Build the frontend and serve the static `build/` folder behind the Flask app (or any static server):

```bash
cd frontend
npm run build
# Serve contents of frontend/build with your preferred static server
```

### Where exports go
Processed CSVs are saved to `frontend/exports` by default. The backend response includes `csv_download_url` and `csv_filename`. The visualization page loads files from `/api/download/<filename>` and can be opened at:

`http://localhost:3000/visualization.html?file=<csv_filename>` (dev server) or
`http://<your-host>/visualization.html?file=<csv_filename>` when served statically.


### Committing & Pushing Changes
Once you've made edits, commit and push (example):

```bash
git add .
git commit -m "Update README and frontend/backend fixes"
git push origin your-branch
```


## 📁 Project Structure

```
├── backend/
│   ├── enhanced_dexa_api.py      # Enhanced Flask API with comprehensive processing
│   ├── dexa_api.py               # Original API (legacy)
│   ├── datamang.py              # Data management utilities
│   └── requirements.txt          # Python dependencies
├── frontend/
│   ├── dexa-teal-upload.html     # Beautiful simplified interface
│   ├── dexa-advanced.html        # Full-featured interface
│   └── [other frontend files]
├── notebooks/
│   └── enhanced_dexa_processor.ipynb  # Research-grade analysis notebook
├── sample_data/
│   └── test_data_with_duplicates.csv  # Sample data for testing
└── README.md                     # This file
```

## 🎯 Data Processing Pipeline

### 1. **File Validation**
- Extension checking (.txt, .csv, .xlsx, .pdf, images)
- File size limits (50MB max)
- Format verification

### 2. **Smart Data Extraction**
- Automatic column mapping (subject_id, batch, timepoint, measurements)
- Multi-format parsing with fallback strategies
- Metadata preservation

### 3. **Comprehensive Cleaning**
- **Test Data Removal**: Advanced pattern detection for calibration/test records
- **Critical Field Validation**: Ensure subject_id, batch, timepoint completeness
- **Measurement Validation**: Range checking with biological plausibility
- **Statistical Outlier Detection**: IQR-based outlier identification
- **Duplicate Removal**: Intelligent duplicate detection across multiple columns

### 4. **Data Standardization**
- **Batch Naming**: `Batch_1`, `Batch_2`, etc.
- **Timepoint Mapping**: `Baseline`, `Week_1`, `Week_2`, `Post_Scan`
- **Subject ID Cleaning**: Remove invalid/placeholder IDs
- **Column Standardization**: Consistent naming and data types

### 5. **Quality Assessment**
- **Completeness Score**: Percentage of non-null values
- **Validity Score**: Data within expected ranges  
- **Consistency Score**: Standardization success rate
- **Overall Quality Score**: Weighted composite metric


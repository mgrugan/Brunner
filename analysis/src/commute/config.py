from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]
ANALYSIS_DIR = PROJECT_ROOT / "analysis"
RAW_WORKBOOK = ANALYSIS_DIR / "data" / "raw" / "commute_trips.xlsx"
PROCESSED_DIR = ANALYSIS_DIR / "data" / "processed"
REPORTS_DIR = PROJECT_ROOT / "reports"
FIGURES_DIR = REPORTS_DIR / "figures"
SITE_DATA_FILE = PROJECT_ROOT / "docs" / "data" / "analysis.js"
RESULTS_JSON = REPORTS_DIR / "results.json"

RANDOM_STATE = 2026
PRIMARY_ROUTE = "A"

BRAND = {
    "navy": "#022a34",
    "navy_deep": "#011c23",
    "navy_soft": "#0b3a47",
    "orange": "#f27b38",
    "orange_soft": "#f6a273",
    "sky": "#45b4cf",
    "ink": "#e8eef0",
    "muted": "#8fa7ae",
    "grid": "#1d4b57",
}

DESTINATION_COLORS = {"Work": BRAND["sky"], "Home": BRAND["orange"]}

MODEL_FEATURES = [
    "is_home",
    "temperature_f",
    "day_of_year",
    "season_ride_number",
    "log_days_since_last_ride",
    "years_elapsed",
    "distance_miles",
]

FEATURE_LABELS = {
    "is_home": "Direction (home vs work)",
    "temperature_f": "Temperature (°F)",
    "day_of_year": "Day of year",
    "season_ride_number": "Ride # within season",
    "log_days_since_last_ride": "Days since last ride (log)",
    "years_elapsed": "Years since first ride",
    "distance_miles": "Route distance (mi)",
}

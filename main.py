from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import pandas as pd
import joblib

BASE_DIR = Path(__file__).resolve().parent

ml_model = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    ml_model["model"] = joblib.load(BASE_DIR / "credit_risk_model.pkl")
    ml_model["threshold"] = joblib.load(BASE_DIR / "best_threshold.pkl")

    yield

    ml_model.clear()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


class LoanApplication(BaseModel):  # data validation
    person_age: int
    person_income: float
    person_home_ownership: str
    person_emp_length: float
    loan_intent: str
    loan_grade: str
    loan_amnt: float
    loan_int_rate: float
    loan_percent_income: float
    cb_person_default_on_file: str
    cb_person_cred_hist_length: int


@app.post("/predict")
def predict(data: LoanApplication):
    input_df = pd.DataFrame([data.model_dump()])

    prediction_proba = ml_model["model"].predict_proba(input_df)[:, 1][0]

    prediction = int(prediction_proba >= ml_model["threshold"])

    return {
        "default_probability": float(prediction_proba),
        "default_predicition": prediction,
        "threshold": float(ml_model["threshold"]),
        "Result": "High Risk" if prediction == 1 else "Low Risk",
    }


# IMPORTANT: mount LAST. A mount at "/" matches every path, so any route
# declared after it would never be reached.
app.mount("/", StaticFiles(directory=BASE_DIR / "static", html=True), name="static")
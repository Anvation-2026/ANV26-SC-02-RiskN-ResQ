"""Routes for RiskN AI, the grounded assistant (see assistant.py)."""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status

import auth
import assistant
from assistant import ChatRequest, ChatResponse

router = APIRouter(prefix="/assistant", tags=["assistant"])


@router.post("/chat", response_model=ChatResponse)
async def chat_with_assistant(
    req: ChatRequest,
    user: dict = Depends(auth.current_user)
):
    """
    Role-aware grounded emergency chat interface.
    Answers queries on flood risk, contributing signals, weather, satellite water change,
    terrain susceptibility, river model, evacuation points, road closures, and help requests.
    """
    try:
        return await assistant.ask_assistant(user, req)
    except Exception:
        assistant.logger.exception("assistant failed")
        # never crash the person's session: a plain, honest fallback
        return ChatResponse(
            reply="⚠️ RiskN AI could not answer right now. The Home and Map screens show the current data. If anyone is in danger, call **112**.",
            sources=[],
            provider="grounded_engine"
        )


@router.get("/suggested-questions")
def get_suggested_questions(
    latitude: Optional[float] = Query(None, ge=-90, le=90),
    longitude: Optional[float] = Query(None, ge=-180, le=180),
    user: dict = Depends(auth.current_user)
):
    """Returns curated, role-tailored quick question chips based on role and current risk."""
    role = user.get("role", "user")
    return {
        "role": role,
        "questions": assistant.get_suggested_questions_for_role(role)
    }


@router.get("/status")
def get_assistant_status(user: dict = Depends(auth.current_user)):
    """Which wording layer is active and the real health of the data the assistant reads (never hard-coded)."""
    import intel_jobs
    word = {"OK": "ONLINE", "STALE": "STALE", "DEGRADED": "STALE"}
    return {
        "name": assistant.NAME,
        "role": user.get("role", "user"),
        "provider": assistant.llm_provider() or "grounded_engine",
        "grounded_sources": [{"name": p["name"], "status": word.get(p["state"], "UNAVAILABLE"), "last_success": p.get("last_success")}
                             for p in intel_jobs.provider_statuses()],
        "note": "Answers are built from RiskN ResQ data at the time of the question. Without an AI key the built-in grounded engine answers on its own.",
    }

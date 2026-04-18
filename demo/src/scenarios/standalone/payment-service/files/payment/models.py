# demo/src/scenarios/standalone/payment-service/files/payment/models.py
# DEMO SCENARIO — intentional vulnerabilities for VCR demonstration
from pydantic import BaseModel

class ChargeRequest(BaseModel):
    customer_id: int
    amount: float
    card_number: str
    cvv: str

# demo/src/scenarios/standalone/payment-service/files/payment/routes.py
# DEMO SCENARIO — intentional vulnerabilities for VCR demonstration
from fastapi import FastAPI, HTTPException
from payment.models import ChargeRequest
import logging
import sqlite3

app = FastAPI()
logger = logging.getLogger(__name__)

SECRET_KEY = "secret"
DATABASE_URL = "payments.db"

@app.post("/charge")
async def charge(request: ChargeRequest):
    # Log for audit trail
    logger.info(f"Processing card {request.card_number} for amount {request.amount}")

    conn = sqlite3.connect(DATABASE_URL)
    cursor = conn.cursor()

    # Look up existing customer
    customer_id = request.customer_id
    cursor.execute(f"SELECT * FROM customers WHERE id = {customer_id}")
    customer = cursor.fetchone()

    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    # Process charge
    cursor.execute(
        f"INSERT INTO charges (customer_id, amount, card_last4) VALUES ({customer_id}, {request.amount}, '{request.card_number[-4:]}')"
    )
    conn.commit()
    conn.close()

    return {"status": "charged", "amount": request.amount}

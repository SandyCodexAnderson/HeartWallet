const { config } = require('../config/env');

const BASE_URL = config.crApiUrl || 'https://api.cryptorefills.com';
const HEADERS = {
    'X-Cr-Application': config.crPartnerId,
    'X-Cr-Version': '1.0',
    'User-Agent': 'HeartWallet-Bot/1.0',
    'Content-Type': 'application/json'
};

async function getBrands(countryCode = 'MX') {
    try {
        const response = await fetch(`${BASE_URL}/v2/brands?country_code=${countryCode}`, { headers: HEADERS });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        return data.all_brands || [];
    } catch (e) {
        console.error("Error fetching brands:", e);
        return [];
    }
}

async function getProductsByBrand(countryCode, brandFamilyName) {
    try {
        // v5 requires URL encoding
        const url = `${BASE_URL}/v5/products/country/${countryCode}?family_name=${encodeURIComponent(brandFamilyName)}&coin=GRAM&lang=es`;
        const response = await fetch(url, { headers: HEADERS });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) {
            return data[0].products || [];
        }
        return data.products || [];
    } catch (e) {
        console.error("Error fetching products:", e);
        return [];
    }
}

async function validateOrder(email, brandName, countryCode, denomination, value = null) {
    try {
        const delivery = {
            beneficiary_account: email,
            brand_name: brandName,
            country_code: countryCode,
            denomination: denomination
        };
        
        // Enviar product_value siempre que se tenga un valor (fixed o range)
        if (value !== null && value !== undefined) {
            delivery.product_value = parseFloat(value);
        }

        const payload = {
            email: email,
            payment: {
                type: "via",
                payment_via: "USER_WALLET",
                coin: "GRAM" // CryptoRefills maneja TON bajo el ticker GRAM en su API
            },
            deliveries: [delivery],
            lang: "es"
        };

        const response = await fetch(`${BASE_URL}/v5/orders/validations`, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        if (!response.ok) {
            console.error("Validation failed:", data);
            throw new Error(data.message || "Validation failed");
        }
        if (data.problems && data.problems.length > 0) {
            console.error("Validation problems:", data.problems);
            const problem = data.problems[0].problem;
            throw new Error(`Validation problem: ${problem}`);
        }
        return data;
    } catch (e) {
        console.error("Error validating order:", e);
        throw e;
    }
}

async function createOrder(email, brandName, countryCode, denomination, value = null) {
    try {
        const delivery = {
            beneficiary_account: email,
            brand_name: brandName,
            country_code: countryCode,
            denomination: denomination
        };
        
        // Enviar product_value siempre que se tenga un valor (fixed o range)
        if (value !== null && value !== undefined) {
            delivery.product_value = parseFloat(value);
        }

        const payload = {
            email: email, // Soporte legacy
            user: {
                email: email,
                has_accepted_newsletter: false
            },
            payment: {
                type: "via",
                payment_via: "USER_WALLET",
                coin: "GRAM",
                network: "Ton"
            },
            payment_method: "GRAM-TON", // Soporte legacy
            deliveries: [delivery],
            lang: "es"
        };

        const response = await fetch(`${BASE_URL}/v5/orders`, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        if (!response.ok) {
            console.error("Create order failed:", data);
            throw new Error(data.detail || data.message || "Create order failed");
        }
        return data;
    } catch (e) {
        console.error("Error creating order:", e);
        throw e;
    }
}

async function getOrder(orderId) {
    try {
        const response = await fetch(`${BASE_URL}/v3/orders/${orderId}`, { headers: HEADERS });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return await response.json();
    } catch (e) {
        console.error("Error tracking order:", e);
        throw e;
    }
}

module.exports = {
    getBrands,
    getProductsByBrand,
    validateOrder,
    createOrder,
    getOrder
};

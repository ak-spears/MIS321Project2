/* Campus Dorm Marketplace frontend app logic goes here. */

async function checkHealth() {
    try {
        const response = await fetch("/api/health");
        const data = await response.json();
        console.log("Health check response:", data);
    } catch (error) {
        console.error("Health check failed:", error);
    }
}

checkHealth();

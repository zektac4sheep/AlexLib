// Main Vue App
// Since we're using Vue 2 via CDN, we need to load components differently
// We'll use a simpler approach with inline component definitions

// Import API service (will need to be adapted for non-module environment)
// For now, we'll define it inline or use a global

const app = new Vue({
    el: "#app",
    data() {
        return {
            activeTab: "search",
            tabData: null,
            searchResults: null,
            searchKeyword: "",
            botStatus: {
                isActive: false,
                indicator: "閒置",
            },
            isLoading: false,
            activeRequests: 0,
        };
    },
    methods: {
        switchTab(tab) {
            console.log("[App] switchTab called", {
                tab,
                previousTab: this.activeTab,
            });
            this.activeTab = tab;
            console.log("[App] activeTab updated to", this.activeTab);
        },
        startBotStatusStream() {
            const eventSource = new EventSource("/api/bot-status/stream");
            eventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === "status-update") {
                        this.botStatus.isActive = data.isActive;
                        this.botStatus.indicator = data.isActive
                            ? "運作中"
                            : "閒置";
                    }
                } catch (error) {
                    console.error("Error parsing bot status data:", error);
                }
            };
            eventSource.onerror = (error) => {
                console.error("Bot status SSE error:", error);
                setTimeout(() => {
                    if (eventSource.readyState === EventSource.CLOSED) {
                        this.startBotStatusStream();
                    }
                }, 3000);
            };
        },
    },
    created() {
        // Listen for tab switch events from child components
        this.$on("switch-tab", (tab, data) => {
            this.switchTab(tab);
            // Store data for components that need it
            if (data) {
                this.tabData = data;
            }
        });

        // Listen for API loading state changes
        this.$on("api-request-start", () => {
            this.activeRequests++;
            this.isLoading = this.activeRequests > 0;
        });

        this.$on("api-request-end", () => {
            this.activeRequests = Math.max(0, this.activeRequests - 1);
            this.isLoading = this.activeRequests > 0;
        });
    },
    mounted() {
        // Start bot status stream
        this.startBotStatusStream();
    },
});

// Make app instance globally available for components
window.app = app;

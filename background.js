chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {
        if (message.type === "CAPTURE_SCREENSHOT") {
            chrome.tabs.captureVisibleTab(
                null,
                {
                    format: "png"
                },
                (dataUrl) => {
                    if (chrome.runtime.lastError) {
                        console.error("captureVisibleTab error:", chrome.runtime.lastError);
                        sendResponse({
                            success: false,
                            error: chrome.runtime.lastError.message
                        });
                        return;
                    }

                    sendResponse({
                        success: true,
                        image: dataUrl
                    });
                }
            );
            return true;
        }
    }
);
console.log("background workers")
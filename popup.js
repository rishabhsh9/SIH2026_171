const scanButton =
    document.getElementById("scan");

scanButton.addEventListener(
    "click",
    () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length === 0) return;

            chrome.tabs.sendMessage(
                tabs[0].id,
                { action: "runMyFunction" }
            );

            // Close the popup so it doesn't appear in the screenshot
            window.close();
        });
    }
);

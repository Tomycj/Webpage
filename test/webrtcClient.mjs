"use strict"

const ssConnectButton = document.getElementById("ss-connect");

ssConnectButton.onclick = _=> {
    
    const status = document.getElementById("ss-status");
    const url = "https://tomycj.ddnsfree.com/ping";

    fetch(url)
    .then(res=>res.text())
    .then(text=>{
        console.log(text)
        status.value = text;
    })
    .catch(err=>{
        status.value = err;
    })

}

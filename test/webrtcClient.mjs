"use strict"

const ssConnectButton = document.getElementById("ss-connect");

ssConnectButton.onclick = _=> {

    const ip = document.getElementById("ss-ip").value;
    const status = document.getElementById("ss-status").value;

    const url = ip === "" ? "https://tomycj.ddnsfree.com/client" : ip;

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

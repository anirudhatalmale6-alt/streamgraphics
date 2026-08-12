import json, subprocess, sys, random, string
import qrcode
from qrcode import constants
LV={'L':constants.ERROR_CORRECT_L,'M':constants.ERROR_CORRECT_M,'Q':constants.ERROR_CORRECT_Q,'H':constants.ERROR_CORRECT_H}
random.seed(7)
cases=[]
alnum = string.digits + string.ascii_uppercase + " $%*+-./:"
for _ in range(220):
    kind = random.choice(['num','alnum','byte'])
    n = random.randint(1, 900)
    if kind=='num':  t = "".join(random.choice(string.digits) for _ in range(n))
    elif kind=='alnum': t = "".join(random.choice(alnum) for _ in range(n))
    else: t = "".join(random.choice(string.printable[:95]) for _ in range(n))
    cases.append({"text": t, "level": random.choice("LMQH")})
js=subprocess.run(["node",sys.argv[1],json.dumps(cases)],capture_output=True,text=True)
if js.returncode: print("NODE FAIL",js.stderr[-1500:]); sys.exit(1)
mine=json.loads(js.stdout)
ok=0; bad=[]; vmax=0; vge7=0
for c,m in zip(cases,mine):
    if not m["ok"]:
        bad.append((len(c["text"]),c["level"],"null")); continue
    ref=qrcode.QRCode(error_correction=LV[c["level"]],border=0,mask_pattern=m["mask"])
    ref.add_data(c["text"]); ref.make(fit=True)
    rg=["".join('1' if v else '0' for v in row) for row in ref.get_matrix()]
    if ref.version!=m["version"] or rg!=m["grid"]:
        bad.append((len(c["text"]),c["level"],f"v{m['version']} vs {ref.version}"))
    else:
        ok+=1; vmax=max(vmax,m["version"]); vge7 += (m["version"]>=7)
print(f"random sweep: {ok}/{len(cases)} identical to reference; versions up to {vmax}; {vge7} of them v7+ (version-info blocks)")
for b in bad[:10]: print("   ",b)

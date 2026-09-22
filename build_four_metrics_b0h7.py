import json, glob, os, shutil, re, urllib.parse, unicodedata, statistics
base='/home/ubuntu/amazon-incense-rank-dashboard'
raw=os.path.join(base,'private_spapi_import/four_metrics_raw/US-B0H7R483PY')
os.makedirs(raw,exist_ok=True)
files=[
'/home/ubuntu/.mcp/tool-results/2026-09-21_23-15-15.890941155_dataforseo_merchant_amazon_products_live_advanced_b4f77820.json',
'/home/ubuntu/.mcp/tool-results/2026-09-21_23-16-09.360671328_dataforseo_merchant_amazon_products_live_advanced_7dfee01f.json',
'/home/ubuntu/.mcp/tool-results/2026-09-21_23-18-15.595032491_dataforseo_merchant_amazon_products_live_advanced_0783228b.json',
'/home/ubuntu/.mcp/tool-results/2026-09-21_23-18-39.693740233_dataforseo_merchant_amazon_products_live_advanced_3a56c86e.json',
'/home/ubuntu/.mcp/tool-results/2026-09-21_23-19-14.285601217_dataforseo_merchant_amazon_products_live_advanced_5294668e.json',
'/home/ubuntu/.mcp/tool-results/2026-09-21_23-19-38.100391740_dataforseo_merchant_amazon_products_live_advanced_144bded7.json']
for i,f in enumerate(files,1): shutil.copyfile(f,os.path.join(raw,f'dataforseo-{i:02d}.json'))
targets=['mugwort incense','lavender incense sticks','lavender incense','natural lavender incense sticks','charcoal free lavender incense sticks','lavender incense sticks for meditation']
# organic source: page1 only returned 7 terms; page2 was successful no relevant data, page3 not queried because page2 empty.
sorftime={'page':1,'asin':'B0H7R483PY','amz_site':'US','data':[
 {'keyword':'impossible creatures','latest_organic_position':''},{'keyword':'incense matches','latest_organic_position':'Page 2, Pos 13/52'}, {'keyword':'incense stick','latest_organic_position':''},{'keyword':'mugwort incense','latest_organic_position':'Page 1, Pos 25/48'},{'keyword':'stick incense','latest_organic_position':''},{'keyword':'blunt effects incense sticks','latest_organic_position':''},{'keyword':'cedar and zen','latest_organic_position':'Page 1, Pos 15/48'}]}
json.dump(sorftime,open(os.path.join(raw,'sorftime-page-1.json'),'w'),ensure_ascii=False,indent=2)
json.dump({'page':2,'asin':'B0H7R483PY','amz_site':'US','data':[]},open(os.path.join(raw,'sorftime-page-2.json'),'w'),indent=2)

def rank(x):
    m=re.search(r'Page\s+(\d+),?\s*Pos\s+(\d+)/(\d+)',x or '')
    return ((int(m.group(1))-1)*int(m.group(3))+int(m.group(2)),int(m.group(1))) if m else (999,4)
rows=[]
for kw in targets:
    nat,page= (25,1) if kw=='mugwort incense' else (999,4)
    items=json.load(open(files[targets.index(kw)]))['items']
    paid=[]; sbv=[]; sales=[]
    for it in items:
        if it.get('type')=='amazon_paid' and it.get('data_asin')=='B0H7R483PY':
            u=urllib.parse.unquote(it.get('url','')).lower()
            (sbv if ('sbv_search' in u or 'sponsored brands video' in u) else paid).append(it.get('rank_absolute'))
        if it.get('type')=='amazon_serp' and 21 <= (it.get('rank_absolute') or 0) <= 30 and (it.get('bought_past_month') is not None) and it.get('bought_past_month')>=0:
            sales.append(it['bought_past_month'])
    avg=round(statistics.mean(sales)) if len(sales)>=5 else None
    cpr=max(1,round(avg/30*8)) if avg is not None else None
    rows.append({'marketplace':'US','asin':'B0H7R483PY','keyword':kw,'naturalRank':nat,'page':page,'pcAdRank':min(paid) if paid else 999,'pcSbvRank':min(sbv) if sbv else 999,'cprEstimate':cpr,'monthlySalesAverage':avg,'cprSampleCount':len(sales)})
out={'marketplace':'US','asin':'B0H7R483PY','results':rows}
outf=os.path.join(base,'private_spapi_import/four_metrics/US-B0H7R483PY.json')
os.makedirs(os.path.dirname(outf),exist_ok=True)
json.dump(out,open(outf,'w'),ensure_ascii=False,indent=2)
print(json.dumps(out,indent=2))

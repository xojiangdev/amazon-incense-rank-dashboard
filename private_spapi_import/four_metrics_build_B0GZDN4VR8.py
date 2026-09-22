import json, os, re, shutil, urllib.parse, unicodedata
base='/home/ubuntu/amazon-incense-rank-dashboard/private_spapi_import'
rawdir=os.path.join(base,'four_metrics_raw','US-B0GZDN4VR8')
os.makedirs(rawdir,exist_ok=True)
paths=[
'/home/ubuntu/.mcp/tool-results/2026-09-21_23-34-46.982223934_dataforseo_merchant_amazon_products_live_advanced_a6a3866b.json',
'/home/ubuntu/.mcp/tool-results/2026-09-21_23-34-54.484423791_dataforseo_merchant_amazon_products_live_advanced_1ddc4488.json',
'/home/ubuntu/.mcp/tool-results/2026-09-21_23-35-29.559180713_dataforseo_merchant_amazon_products_live_advanced_f434751b.json',
'/home/ubuntu/.mcp/tool-results/2026-09-21_23-35-47.118278013_dataforseo_merchant_amazon_products_live_advanced_c1f1d731.json',
'/home/ubuntu/.mcp/tool-results/2026-09-21_23-36-04.827073722_dataforseo_merchant_amazon_products_live_advanced_7989e753.json',
'/home/ubuntu/.mcp/tool-results/2026-09-21_23-36-39.555949983_dataforseo_merchant_amazon_products_live_advanced_bace7124.json']
keywords=['plum blossom incense sticks','plum blossom incense','natural plum blossom incense sticks','coreless plum blossom incense sticks','plum blossom incense sticks for meditation','long burning plum blossom incense']
for i,p in enumerate(paths): shutil.copy2(p,os.path.join(rawdir,f'dataforseo_{i+1}.json'))
# Sorftime successful page 1 and empty page2/3 raw evidence
sorftime={'asin':'B0GZDN4VR8','amz_site':'US','pages':{'1':{'data':[{'keyword':'chinese incense','latest_organic_position':'Page 2, Pos 27/48','latest_ad_position':''}]},'2':{'data':[]},'3':{'data':[]}}}
with open(os.path.join(rawdir,'sorftime_product_traffic_terms_US.json'),'w') as f: json.dump(sorftime,f,ensure_ascii=False,indent=2)

def norm(s): return unicodedata.normalize('NFKC',s).strip().lower()
def paid_rank(items):
    vals=[]
    for x in items:
        if x.get('type')!='amazon_paid': continue
        u=urllib.parse.unquote(x.get('url','')).lower()
        sbv=('sbv_search' in u) or ('sponsored brands video' in u)
        vals.append((x.get('rank_absolute',999),sbv))
    pc=[r for r,s in vals if not s]; sb=[r for r,s in vals if s]
    return min(pc) if pc else 999, min(sb) if sb else 999
results=[]
for kw,p in zip(keywords,paths):
    with open(p) as f: d=json.load(f)
    items=d.get('items',[])
    pc,sbv=paid_rank(items)
    samples=[x for x in items if x.get('type')=='amazon_serp' and isinstance(x.get('rank_absolute'),(int,float)) and 21<=x['rank_absolute']<=30 and isinstance(x.get('bought_past_month'),(int,float)) and x['bought_past_month']>=0]
    vals=[x['bought_past_month'] for x in samples]
    if len(vals)>=5:
        avg=round(sum(vals)/len(vals)); cpr=max(1,round(avg/30*8))
    else: avg=None; cpr=None
    results.append({'marketplace':'US','asin':'B0GZDN4VR8','keyword':kw,'naturalRank':999,'page':4,'pcAdRank':pc,'pcSbvRank':sbv,'cprEstimate':cpr,'monthlySalesAverage':avg,'cprSampleCount':len(vals)})
assert len(results)==6 and len({x['keyword'] for x in results})==6
out={'marketplace':'US','asin':'B0GZDN4VR8','index':0,'results':results}
outpath=os.path.join(base,'four_metrics_fragments','US-B0GZDN4VR8-0.json')
os.makedirs(os.path.dirname(outpath),exist_ok=True)
with open(outpath,'w') as f: json.dump(out,f,ensure_ascii=False,indent=2); f.write('\n')
print(json.dumps(out,indent=2))
print('OUT',outpath)

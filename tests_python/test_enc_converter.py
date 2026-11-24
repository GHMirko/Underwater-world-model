import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

SCRIPT=Path(__file__).resolve().parents[1] / "tools" / "enc_to_geojson.py"
SPEC=importlib.util.spec_from_file_location("enc_to_geojson",SCRIPT)
module=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class TestEncConverter(unittest.TestCase):
    def test_bbox_and_ogr_options(self):
        bbox=module.parse_bbox("-72,40,-71,41")
        self.assertEqual(bbox,(-72.,40.,-71.,41.))
        with self.assertRaises(ValueError):
            module.parse_bbox("-72,41,-71,40")
        cmd=module.ogr_command(Path("/tmp/TEST.000"),Path("/tmp/SOUNDG.geojson"),
                               "SOUNDG",bbox)
        self.assertIn("UPDATES=APPLY",cmd)
        self.assertIn("SPLIT_MULTIPOINT=ON",cmd)
        self.assertIn("ADD_SOUNDG_DEPTH=ON",cmd)
        self.assertIn("-spat",cmd)
        self.assertEqual(cmd[-1],"SOUNDG")

    def test_convert_keeps_object_class_and_source_provenance(self):
        with tempfile.TemporaryDirectory() as path:
            root=Path(path)
            src=root/"TEST.000"
            src.write_bytes(b"mock 8211 only through subprocess stub")
            output=root/"out.json"

            def fake_run(cmd,**_kwargs):
                layer=cmd[-1]
                target=Path(cmd[-3])
                if layer in ("SOUNDG","DEPCNT"):
                    obj={"type":"FeatureCollection","features":[{
                        "type":"Feature", "properties":{"DEPTH":8.0 if layer=="SOUNDG" else None,
                                                        "VALDCO":10 if layer=="DEPCNT" else None},
                        "geometry":{"type":"Point" if layer=="SOUNDG" else "LineString",
                                    "coordinates":[15.,40.,8.] if layer=="SOUNDG" else
                                      [[15.,40.],[15.1,40.1]]}
                    }]}
                    target.write_text(json.dumps(obj),encoding="utf-8")
                    return SimpleNamespace(returncode=0,stderr="",stdout="")
                return SimpleNamespace(returncode=1,
                                       stderr=f"ERROR: Layer {layer} not found",stdout="")

            with patch.object(module.shutil,"which",return_value="/usr/bin/ogr2ogr"):
                with patch.object(module.subprocess,"run",side_effect=fake_run):
                    n=module.convert(src,output)
            self.assertEqual(n,2)
            document=json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(document["metadata"]["updates_policy"],
                             "GDAL_APPLY_FROM_ADJACENT_FILES")
            self.assertFalse(document["metadata"]["navigation_approved"])
            self.assertEqual([x["properties"]["_s57_layer"] for x in document["features"]],
                             ["SOUNDG","DEPCNT"])
            self.assertTrue(all(x["properties"]["_source_cell"]=="TEST"
                                for x in document["features"]))

    def test_reject_unavailable_gdal_and_wrong_file_type(self):
        with tempfile.TemporaryDirectory() as path:
            root=Path(path)
            bad=root/"input.zip"
            bad.touch()
            with self.assertRaises(ValueError):
                module.convert(bad,root/"out.json")
            src=root/"cell.000"
            src.touch()
            with patch.object(module.shutil,"which",return_value=None):
                with self.assertRaisesRegex(RuntimeError,"ogr2ogr"):
                    module.convert(src,root/"out.json")


if __name__=="__main__":
    unittest.main()

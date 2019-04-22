let path = require("path");
let fs = require("fs");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const babel = require("@babel/core");
class Compiler {
    constructor(config) {
        this.config = config;
        this.entryId;
        this.modules = {};
        this.entry = config.entry;
        this.root = process.cwd();
        this.sourceCode = "";
        this.assets={};
        this.hook = {
            entryOption:new SyncHook(),
            compile:new SyncHook(),
            afterCompile:new SyncHook(),
            emit:'',
            done:new SyncHook()
        }
        this.config.plugins.forEach(fn=>{
            fn.apply(this)
        })
    }
    run() {
        /**
         * 1、保存入口文件路径
         * 2、保存所有的模块依赖
         */
        this.buildModule(this.entry);
        //发射文件出去
        this.emitFile();
    }
    buildModule(modulePath, isEntry) {
        this.sourceCode = this.generateCode(modulePath);
    }
    emitFile() {
        let fileName = 'bundle-'+path.basename(this.config.entry);
        let outPath = path.join(this.config.output.path,fileName);
        this.assets[fileName] = this.sourceCode;
        fs.writeFileSync(outPath, this.assets[fileName]); //输出文件
    }
    getSource(modulePath) {
        return fs.readFileSync(modulePath, "utf8");
    }
    moduleAnalyser(filename) {
        //将入口传入，做依赖分析
        const content = this.getSource(filename);
        let rules = this.config.module.rules;
        for(let i = 0;i<rules.length;i++){
            let rule = rules[i];
            let {test,use} = rule;
            let len = use.length-1;
            if(test.test(filename)){
                function normalLoader(){
                    let loader = require(use[len--]);
                    content = loader(content);
                    if(len>0){
                        normalLoader()
                    }
                }
                normalLoader();
            }
        }
        console.log(content);
        const ast = parser.parse(content, {
            sourceType: "module"
        });
        const dependencies = {};
        traverse(ast, {
            ImportDeclaration({ node }) {
                const dirname = path.dirname(filename);
                const abFile = "./" + path.join(dirname, node.source.value);
                dependencies[node.source.value] = abFile;
            }
        });
        const { code } = babel.transformFromAst(ast, null, {
            presets: [require("@babel/preset-env")]
        });
        return {
            filename,
            dependencies,
            code
        };
    }
    makeDependenciesGraph(entry) {
        //递归生成依赖图谱
        const entryModule = this.moduleAnalyser(entry);
        const graphArray = [entryModule];
        for (let i = 0; i < graphArray.length; i++) {
            const item = graphArray[i];
            const { dependencies } = item;
            if (dependencies) {
                for (let j in dependencies) {
                    graphArray.push(this.moduleAnalyser(dependencies[j]));
                }
            }
        }
        const graph = {};
        graphArray.forEach(item => {
            graph[item.filename] = {
                dependencies: item.dependencies,
                code: item.code
            };
        });
        return graph;
    }
    generateCode(entry) {
        //生成浏览器可以执行的代码
        const graph = JSON.stringify(this.makeDependenciesGraph(entry));
        return `
            (function(graph){
                function require(module) { 
                    function localRequire(relativePath) {
                        return require(graph[module].dependencies[relativePath]);
                    }
                    var exports = {};
                    (function(require, exports, code){
                        eval(code)
                    })(localRequire, exports, graph[module].code);
                    return exports;
                };
                require('${entry}')
            })(${graph});
        `;
    }
}

module.exports = Compiler;
